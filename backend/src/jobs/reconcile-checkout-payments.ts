import { randomUUID } from "node:crypto"
import { monitorEventLoopDelay, performance } from "node:perf_hooks"

import { completeCartWorkflow } from "@medusajs/core-flows"
import type {
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import {
  CHECKOUT_RECONCILIATION_JOB_LOCK,
  type CheckoutReconciliationQuery,
  reconcileCheckoutPayments,
  resolveCheckoutReconciliationConfig,
} from "../lib/checkout/reconciliation"
import { CHECKOUT_RECONCILIATION_LOCK_TTL_SECONDS } from "../lib/workflow-worker-options"

type ScheduledJobContext = {
  scheduledFor?: Date
}

type JobLogLevel = "error" | "info" | "warn"

const SCHEDULE_DELAY_WARNING_MS = 30_000
const DURATION_WARNING_MS = 30_000
const EVENT_LOOP_DELAY_WARNING_MS = 1_000

const roundMilliseconds = (value: number): number =>
  Number(Math.max(0, value).toFixed(3))

const deploymentIdentity = () => ({
  commit_sha:
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    "unknown",
  environment:
    process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "unknown",
  service: "backend",
})

const writeJobLog = (
  logger: Logger,
  level: JobLogLevel,
  event: Record<string, unknown>
): void => {
  const payload = JSON.stringify({ ...deploymentIdentity(), ...event })
  if (level === "error") {
    logger.error(payload)
    return
  }
  if (level === "warn") {
    logger.warn(payload)
    return
  }
  logger.info(payload)
}

const isLockConflict = (error: unknown): boolean =>
  error instanceof MedusaError && error.type === MedusaError.Types.CONFLICT

export default async function reconcileCheckoutPaymentsJob(
  container: MedusaContainer,
  context: ScheduledJobContext = {}
) {
  const logger = container.resolve<Logger>("logger")
  const reconciliationConfig = resolveCheckoutReconciliationConfig()
  if (!reconciliationConfig.enabled) {
    return
  }

  const runId = randomUUID()
  const startedAt = new Date()
  const scheduledFor =
    context.scheduledFor instanceof Date &&
    Number.isFinite(context.scheduledFor.getTime())
      ? context.scheduledFor
      : startedAt
  const scheduleDelayMs = roundMilliseconds(
    startedAt.getTime() - scheduledFor.getTime()
  )
  const timingStartedAt = performance.now()
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
  eventLoopDelay.enable()
  const lockingService = container.resolve<ILockingModule>(Modules.LOCKING)
  const query = container.resolve<CheckoutReconciliationQuery>(
    ContainerRegistrationKeys.QUERY
  )
  const lockOwnerId = randomUUID()
  const lockStartedAt = performance.now()
  let lockAcquired = false
  let lockWaitMs = 0

  try {
    await lockingService.acquire(CHECKOUT_RECONCILIATION_JOB_LOCK, {
      expire: CHECKOUT_RECONCILIATION_LOCK_TTL_SECONDS,
      ownerId: lockOwnerId,
    })
    lockAcquired = true
    lockWaitMs = roundMilliseconds(performance.now() - lockStartedAt)
  } catch (error) {
    eventLoopDelay.disable()
    const timing = {
      duration_ms: roundMilliseconds(performance.now() - timingStartedAt),
      event_loop_delay_max_ms: roundMilliseconds(
        eventLoopDelay.max / 1_000_000
      ),
      lock_wait_ms: roundMilliseconds(performance.now() - lockStartedAt),
      run_id: runId,
      schedule_delay_ms: scheduleDelayMs,
      scheduled_for: scheduledFor.toISOString(),
      started_at: startedAt.toISOString(),
    }
    if (isLockConflict(error)) {
      writeJobLog(logger, "warn", {
        event: "job.checkout_reconciliation.skipped",
        message: "Checkout reconciliation skipped because a run holds the lock",
        reason: "lock_held",
        ...timing,
      })
      return
    }
    writeJobLog(logger, "error", {
      event: "job.checkout_reconciliation.failed",
      failure_stage: "lock_acquisition",
      message: "Checkout reconciliation failed",
      ...timing,
    })
    throw error
  }

  let result: Awaited<ReturnType<typeof reconcileCheckoutPayments>> | undefined
  let runError: unknown
  try {
    result = await reconcileCheckoutPayments({
      query,
      config: reconciliationConfig,
      completeCart: async (cartId) => {
        await completeCartWorkflow(container).run({
          input: { id: cartId },
        })
      },
    })
  } catch (error) {
    runError = error
  }

  let lockReleased = false
  if (lockAcquired) {
    try {
      lockReleased = await lockingService.release(
        CHECKOUT_RECONCILIATION_JOB_LOCK,
        { ownerId: lockOwnerId }
      )
    } catch {
      lockReleased = false
    }
  }
  eventLoopDelay.disable()
  const durationMs = roundMilliseconds(performance.now() - timingStartedAt)
  const timing = {
    duration_ms: durationMs,
    event_loop_delay_max_ms: roundMilliseconds(
      eventLoopDelay.max / 1_000_000
    ),
    lock_released: lockReleased,
    lock_wait_ms: lockWaitMs,
    run_id: runId,
    schedule_delay_ms: scheduleDelayMs,
    scheduled_for: scheduledFor.toISOString(),
    started_at: startedAt.toISOString(),
  }

  if (runError) {
    writeJobLog(logger, "error", {
      event: "job.checkout_reconciliation.failed",
      failure_stage: "reconciliation",
      message: "Checkout reconciliation failed",
      ...timing,
    })
    throw runError
  }
  if (!result) {
    writeJobLog(logger, "error", {
      event: "job.checkout_reconciliation.failed",
      failure_stage: "result",
      message: "Checkout reconciliation failed",
      ...timing,
    })
    throw new Error("Checkout reconciliation returned no result")
  }

  const needsAttention =
    result.failed > 0 ||
    result.capped ||
    result.timeCapped ||
    result.scanWindowFull ||
    !lockReleased ||
    scheduleDelayMs >= SCHEDULE_DELAY_WARNING_MS ||
    durationMs >= DURATION_WARNING_MS ||
    timing.event_loop_delay_max_ms >= EVENT_LOOP_DELAY_WARNING_MS
  writeJobLog(logger, needsAttention ? "warn" : "info", {
    event: needsAttention
      ? "job.checkout_reconciliation.attention"
      : "job.checkout_reconciliation.completed",
    message: needsAttention
      ? "Checkout reconciliation needs attention"
      : "Checkout reconciliation completed",
    ...result,
    ...timing,
  })
}

export const config = {
  name: "reconcile-checkout-payments",
  schedule: "*/2 * * * *",
}
