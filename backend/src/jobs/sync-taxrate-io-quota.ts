import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import type { Logger, MedusaContainer } from "@medusajs/framework/types"

import { recordOperationResult } from "../lib/observability/operation-telemetry"
import { buildBackendRuntimeEvent } from "../lib/observability/runtime-event"
import { scheduledBullJobIdentity } from "../lib/observability/scheduled-job-identity"
import {
  syncTaxRateIoQuota,
  type TaxRateIoQuotaSyncObservation,
} from "../lib/tax-control/quota"
import type TaxControlModuleService from "../modules/tax-control/service"

type ScheduledJobContext = {
  bullJobIdSha256?: unknown
  scheduledFor?: Date
}

export default async function syncTaxRateIoQuotaJob(
  container: MedusaContainer,
  context: ScheduledJobContext = {}
): Promise<void> {
  const logger = container.resolve<Logger>("logger")
  const runId = randomUUID()
  const startedAt = new Date()
  const monotonicStartedAt = performance.now()
  const identity = scheduledBullJobIdentity(context.bullJobIdSha256)
  const scheduledFor =
    context.scheduledFor instanceof Date &&
    Number.isFinite(context.scheduledFor.getTime())
      ? context.scheduledFor
      : startedAt
  const observation: TaxRateIoQuotaSyncObservation = {
    redisSnapshotsValidated: 0,
    quotaRowsReturned: 0,
    quotaWritesConfirmed: 0,
  }
  const recordRun = (
    outcome: "completed" | "failed",
    finishedAt: Date,
    durationMs: number
  ): void => {
    try {
      recordOperationResult(
        { domain: "scheduled_job", operation: "run" },
        outcome === "failed" ? "error" : "ok",
        durationMs
      )
      const event = JSON.stringify({
        ...buildBackendRuntimeEvent(
          `job.taxrate_quota_sync.${outcome}`,
          outcome === "failed"
            ? "TaxRate.io quota synchronization failed"
            : "TaxRate.io quota synchronization completed",
          finishedAt
        ),
        ...identity,
        run_id: runId,
        scheduled_for: scheduledFor.toISOString(),
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: Number(durationMs.toFixed(3)),
        failure_stage: outcome === "failed" ? "synchronization" : null,
        counts_available: outcome === "completed",
        redis_snapshots_validated:
          outcome === "completed" ? observation.redisSnapshotsValidated : null,
        quota_rows_returned:
          outcome === "completed" ? observation.quotaRowsReturned : null,
        quota_writes_confirmed:
          outcome === "completed" ? observation.quotaWritesConfirmed : null,
      })
      if (outcome === "failed") logger.error(event)
      else logger.info(event)
    } catch {
      // An observability failure must not change the scheduled job outcome.
    }
  }
  try {
    const service = container.resolve<TaxControlModuleService>("tax_control")
    await syncTaxRateIoQuota({ logger, service, observation })
    const finishedAt = new Date()
    const durationMs = Math.max(0, performance.now() - monotonicStartedAt)
    recordRun("completed", finishedAt, durationMs)
  } catch (error) {
    const finishedAt = new Date()
    const durationMs = Math.max(0, performance.now() - monotonicStartedAt)
    recordRun("failed", finishedAt, durationMs)
    throw error
  }
}

export const config = {
  name: "sync-taxrate-io-quota",
  schedule: "*/5 * * * *",
}
