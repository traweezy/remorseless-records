import { z } from "zod"

import {
  getSharedRedisClient,
  withRedisTimeout,
} from "../shared-redis-client"

export const CHECKOUT_SCHEDULER_HEARTBEAT_KEY =
  "rr:health:checkout-reconciliation:latest:v1"
export const CHECKOUT_SCHEDULER_INCIDENT_KEY =
  "rr:health:checkout-reconciliation:incident:v1"
export const CHECKOUT_SCHEDULER_HEARTBEAT_TTL_SECONDS = 15 * 60
export const CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS = 24 * 60 * 60
export const CHECKOUT_SCHEDULER_MAX_HEARTBEAT_AGE_SECONDS = 10 * 60
export const CHECKOUT_SCHEDULER_MAX_REDIS_LATENCY_MS = 250
const CHECKOUT_SCHEDULER_MAX_CLOCK_SKEW_SECONDS = 60

const schedulerEventSchema = z.enum([
  "job.checkout_reconciliation.attention",
  "job.checkout_reconciliation.completed",
  "job.checkout_reconciliation.failed",
  "job.checkout_reconciliation.skipped",
])
const commitShaSchema = z.union([
  z.string().regex(/^[0-9a-f]{40}$/u),
  z.literal("unknown"),
])
const optionalCountSchema = z.number().int().nonnegative().optional()
const optionalDurationSchema = z.number().finite().nonnegative().optional()

const schedulerEventInputSchema = z
  .object({
    attempted: optionalCountSchema,
    capped: z.boolean().optional(),
    commit_sha: commitShaSchema,
    completed: optionalCountSchema,
    duration_ms: optionalDurationSchema,
    eligible: optionalCountSchema,
    event: schedulerEventSchema,
    event_loop_delay_max_ms: optionalDurationSchema,
    failed: optionalCountSchema,
    heldForReview: optionalCountSchema,
    lock_released: z.boolean().optional(),
    lock_wait_ms: optionalDurationSchema,
    scanWindowFull: z.boolean().optional(),
    scanned: optionalCountSchema,
    schedule_delay_ms: optionalDurationSchema,
    timeCapped: z.boolean().optional(),
  })
  .passthrough()

const schedulerSnapshotSchema = z.object({
  schema_version: z.literal(1),
  status: z.enum(["attention", "completed", "failed", "skipped"]),
  event: schedulerEventSchema,
  recorded_at: z.string().datetime({ offset: true }),
  commit_sha: commitShaSchema,
  attempted: optionalCountSchema,
  capped: z.boolean().optional(),
  completed: optionalCountSchema,
  duration_ms: optionalDurationSchema,
  eligible: optionalCountSchema,
  event_loop_delay_max_ms: optionalDurationSchema,
  failed: optionalCountSchema,
  held_for_review: optionalCountSchema,
  lock_released: z.boolean().optional(),
  lock_wait_ms: optionalDurationSchema,
  scan_window_full: z.boolean().optional(),
  scanned: optionalCountSchema,
  schedule_delay_ms: optionalDurationSchema,
  time_capped: z.boolean().optional(),
})

export type CheckoutSchedulerSnapshot = z.infer<
  typeof schedulerSnapshotSchema
>

export type CheckoutSchedulerHealthPayload = {
  checked_at: string
  heartbeat: CheckoutSchedulerSnapshot | null
  heartbeat_age_seconds: number | null
  incident: CheckoutSchedulerSnapshot | null
  observation_window_seconds: number
  reasons: string[]
  redis: "error" | "ok"
  redis_latency_ms: number | null
  schema_version: 1
  status: "degraded" | "healthy"
}

const eventStatus = (
  event: z.infer<typeof schedulerEventSchema>
): CheckoutSchedulerSnapshot["status"] =>
  event.slice(event.lastIndexOf(".") + 1) as CheckoutSchedulerSnapshot["status"]

const optionalField = <T>(key: string, value: T | undefined) =>
  value === undefined ? {} : { [key]: value }

export const buildCheckoutSchedulerSnapshot = (
  input: Record<string, unknown>,
  recordedAt = new Date()
): CheckoutSchedulerSnapshot => {
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Scheduler snapshot time must be valid")
  }
  const event = schedulerEventInputSchema.parse(input)

  return schedulerSnapshotSchema.parse({
    schema_version: 1,
    status: eventStatus(event.event),
    event: event.event,
    recorded_at: recordedAt.toISOString(),
    commit_sha: event.commit_sha,
    ...optionalField("attempted", event.attempted),
    ...optionalField("capped", event.capped),
    ...optionalField("completed", event.completed),
    ...optionalField("duration_ms", event.duration_ms),
    ...optionalField("eligible", event.eligible),
    ...optionalField(
      "event_loop_delay_max_ms",
      event.event_loop_delay_max_ms
    ),
    ...optionalField("failed", event.failed),
    ...optionalField("held_for_review", event.heldForReview),
    ...optionalField("lock_released", event.lock_released),
    ...optionalField("lock_wait_ms", event.lock_wait_ms),
    ...optionalField("scan_window_full", event.scanWindowFull),
    ...optionalField("scanned", event.scanned),
    ...optionalField("schedule_delay_ms", event.schedule_delay_ms),
    ...optionalField("time_capped", event.timeCapped),
  })
}

export const recordCheckoutSchedulerHealth = async (
  input: Record<string, unknown>
): Promise<boolean> => {
  const snapshot = buildCheckoutSchedulerSnapshot(input)
  const client = await getSharedRedisClient()
  if (!client) {
    return false
  }

  const serialized = JSON.stringify(snapshot)
  const writes = [
    client.set(CHECKOUT_SCHEDULER_HEARTBEAT_KEY, serialized, {
      EX: CHECKOUT_SCHEDULER_HEARTBEAT_TTL_SECONDS,
    }),
  ]
  if (snapshot.status !== "completed") {
    writes.push(
      client.set(CHECKOUT_SCHEDULER_INCIDENT_KEY, serialized, {
        EX: CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS,
      })
    )
  }
  await withRedisTimeout(Promise.all(writes))
  return true
}

const parseSnapshot = (value: string | null) => {
  if (value === null) {
    return { invalid: false, snapshot: null }
  }
  try {
    const parsed = schedulerSnapshotSchema.safeParse(JSON.parse(value))
    return parsed.success
      ? { invalid: false, snapshot: parsed.data }
      : { invalid: true, snapshot: null }
  } catch {
    return { invalid: true, snapshot: null }
  }
}

export const evaluateCheckoutSchedulerHealth = ({
  incidentValue,
  latestValue,
  now = new Date(),
  redisAvailable,
  redisLatencyMs = null,
}: {
  incidentValue: string | null
  latestValue: string | null
  now?: Date
  redisAvailable: boolean
  redisLatencyMs?: number | null
}): CheckoutSchedulerHealthPayload => {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Scheduler health evaluation time must be valid")
  }

  const reasons = new Set<string>()
  if (!redisAvailable) {
    reasons.add("redis_unavailable")
  }
  const safeRedisLatencyMs =
    redisLatencyMs !== null &&
    Number.isFinite(redisLatencyMs) &&
    redisLatencyMs >= 0
      ? Number(redisLatencyMs.toFixed(3))
      : null
  if (redisAvailable && safeRedisLatencyMs === null) {
    reasons.add("redis_latency_missing")
  }
  if (
    safeRedisLatencyMs !== null &&
    safeRedisLatencyMs >= CHECKOUT_SCHEDULER_MAX_REDIS_LATENCY_MS
  ) {
    reasons.add("redis_latency_high")
  }
  const latest = parseSnapshot(latestValue)
  const incident = parseSnapshot(incidentValue)
  if (latest.invalid || incident.invalid) {
    reasons.add("scheduler_state_invalid")
  }

  let heartbeatAgeSeconds: number | null = null
  if (!latest.snapshot) {
    reasons.add("scheduler_heartbeat_missing")
  } else {
    const rawHeartbeatAgeSeconds =
      (now.getTime() - Date.parse(latest.snapshot.recorded_at)) / 1_000
    heartbeatAgeSeconds = Number(
      Math.max(0, rawHeartbeatAgeSeconds).toFixed(3)
    )
    if (rawHeartbeatAgeSeconds < -CHECKOUT_SCHEDULER_MAX_CLOCK_SKEW_SECONDS) {
      reasons.add("scheduler_heartbeat_from_future")
    }
    if (
      heartbeatAgeSeconds > CHECKOUT_SCHEDULER_MAX_HEARTBEAT_AGE_SECONDS
    ) {
      reasons.add("scheduler_heartbeat_stale")
    }
    if (latest.snapshot.status !== "completed") {
      reasons.add("scheduler_latest_unhealthy")
    }
  }
  if (incident.snapshot) {
    reasons.add("scheduler_incident_latched")
  }

  const reasonList = [...reasons].toSorted()
  return {
    checked_at: now.toISOString(),
    heartbeat: latest.snapshot,
    heartbeat_age_seconds: heartbeatAgeSeconds,
    incident: incident.snapshot,
    observation_window_seconds: CHECKOUT_SCHEDULER_INCIDENT_TTL_SECONDS,
    reasons: reasonList,
    redis: redisAvailable ? "ok" : "error",
    redis_latency_ms: safeRedisLatencyMs,
    schema_version: 1,
    status: reasonList.length === 0 ? "healthy" : "degraded",
  }
}

export const readCheckoutSchedulerHealth =
  async (): Promise<CheckoutSchedulerHealthPayload> => {
    try {
      const client = await getSharedRedisClient()
      if (!client) {
        return evaluateCheckoutSchedulerHealth({
          incidentValue: null,
          latestValue: null,
          redisAvailable: false,
        })
      }
      const redisStartedAt = performance.now()
      const [ping, latestValue, incidentValue] = await withRedisTimeout(
        Promise.all([
          client.ping(),
          client.get(CHECKOUT_SCHEDULER_HEARTBEAT_KEY),
          client.get(CHECKOUT_SCHEDULER_INCIDENT_KEY),
        ])
      )
      return evaluateCheckoutSchedulerHealth({
        incidentValue,
        latestValue,
        redisAvailable: ping === "PONG",
        redisLatencyMs: performance.now() - redisStartedAt,
      })
    } catch {
      return evaluateCheckoutSchedulerHealth({
        incidentValue: null,
        latestValue: null,
        redisAvailable: false,
      })
    }
  }
