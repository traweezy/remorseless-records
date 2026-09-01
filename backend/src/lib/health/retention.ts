import { z } from "zod"

import { getBackendRuntimeIdentity } from "../observability/runtime-identity"
import { getSharedRedisClient, withRedisTimeout } from "../shared-redis-client"

export const RETENTION_HEALTH_TTL_SECONDS = 3 * 24 * 60 * 60
export const RETENTION_MAX_HEARTBEAT_AGE_SECONDS = 36 * 60 * 60
export const ANONYMOUS_CART_RETENTION_HEALTH_KEY =
  "rr:health:anonymous-cart-retention:latest:v1"
export const ABANDONED_CHECKOUT_RETENTION_HEALTH_KEY =
  "rr:health:abandoned-checkout-retention:latest:v1"
const RETENTION_MAX_CLOCK_SKEW_SECONDS = 60

export const retentionJobNames = [
  "anonymous_cart",
  "abandoned_checkout",
] as const
export const retentionJobStatuses = ["completed", "disabled", "failed"] as const

const optionalCountSchema = z.number().int().nonnegative().optional()
const commitShaSchema = z.union([
  z.string().regex(/^[0-9a-f]{40}$/u),
  z.literal("unknown"),
])

const retentionSnapshotSchema = z.object({
  capped: z.boolean().optional(),
  commit_sha: commitShaSchema,
  cutoff: z.string().datetime({ offset: true }).optional(),
  deleted: optionalCountSchema,
  duration_ms: z.number().finite().nonnegative(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  event: z.string().regex(/^job\.retention\.[a-z_]+\.[a-z]+$/u),
  job: z.enum(retentionJobNames),
  message: z.string().min(1).max(160),
  payment_collections_canceled: optionalCountSchema,
  protected_by_email: optionalCountSchema,
  protected_by_order: optionalCountSchema,
  protected_by_payment: optionalCountSchema,
  recorded_at: z.string().datetime({ offset: true }),
  request_id: z.literal("unknown"),
  run_id: z.string().uuid(),
  scanned: optionalCountSchema,
  schema_version: z.literal(1),
  service: z.literal("backend"),
  span_id: z.literal("unknown"),
  started_at: z.string().datetime({ offset: true }),
  status: z.enum(retentionJobStatuses),
  trace_id: z.literal("unknown"),
})

export type RetentionJobName = (typeof retentionJobNames)[number]
export type RetentionJobStatus = (typeof retentionJobStatuses)[number]
export type RetentionSnapshot = z.infer<typeof retentionSnapshotSchema>

export type RetentionHealthPayload = {
  checked_at: string
  jobs: Record<RetentionJobName, RetentionSnapshot | null>
  observation_window_seconds: number
  reasons: string[]
  redis: "error" | "ok"
  schema_version: 1
  status: "degraded" | "healthy"
}

type RetentionSnapshotInput = {
  capped?: boolean
  cutoff?: string
  deleted?: number
  durationMs: number
  job: RetentionJobName
  paymentCollectionsCanceled?: number
  protectedByEmail?: number
  protectedByOrder?: number
  protectedByPayment?: number
  runId: string
  scanned?: number
  startedAt: Date
  status: RetentionJobStatus
}

const optionalField = <T>(key: string, value: T | undefined) =>
  value === undefined ? {} : { [key]: value }

const statusMessage = (job: RetentionJobName, status: RetentionJobStatus) => {
  const subject =
    job === "anonymous_cart"
      ? "Anonymous cart retention"
      : "Abandoned checkout retention"
  if (status === "disabled") {
    return `${subject} is disabled`
  }
  return `${subject} ${status}`
}

export const buildRetentionSnapshot = (
  input: RetentionSnapshotInput,
  recordedAt = new Date()
): RetentionSnapshot => {
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Retention snapshot time must be valid")
  }
  if (!Number.isFinite(input.startedAt.getTime())) {
    throw new TypeError("Retention start time must be valid")
  }

  return retentionSnapshotSchema.parse({
    ...getBackendRuntimeIdentity(),
    schema_version: 1,
    event: `job.retention.${input.job}.${input.status}`,
    job: input.job,
    message: statusMessage(input.job, input.status),
    recorded_at: recordedAt.toISOString(),
    request_id: "unknown",
    run_id: input.runId,
    span_id: "unknown",
    started_at: input.startedAt.toISOString(),
    status: input.status,
    trace_id: "unknown",
    duration_ms: Number(Math.max(0, input.durationMs).toFixed(3)),
    ...optionalField("capped", input.capped),
    ...optionalField("cutoff", input.cutoff),
    ...optionalField("deleted", input.deleted),
    ...optionalField(
      "payment_collections_canceled",
      input.paymentCollectionsCanceled
    ),
    ...optionalField("protected_by_email", input.protectedByEmail),
    ...optionalField("protected_by_order", input.protectedByOrder),
    ...optionalField("protected_by_payment", input.protectedByPayment),
    ...optionalField("scanned", input.scanned),
  })
}

const keyForJob = (job: RetentionJobName): string =>
  job === "anonymous_cart"
    ? ANONYMOUS_CART_RETENTION_HEALTH_KEY
    : ABANDONED_CHECKOUT_RETENTION_HEALTH_KEY

export const recordRetentionHealth = async (
  snapshot: RetentionSnapshot
): Promise<boolean> => {
  const parsed = retentionSnapshotSchema.parse(snapshot)
  const client = await getSharedRedisClient()
  if (!client) {
    return false
  }
  await withRedisTimeout(
    client.set(keyForJob(parsed.job), JSON.stringify(parsed), {
      EX: RETENTION_HEALTH_TTL_SECONDS,
    })
  )
  return true
}

const parseSnapshot = (value: string | null): RetentionSnapshot | null => {
  if (value === null) {
    return null
  }
  try {
    const payload: unknown = JSON.parse(value)
    const parsed = retentionSnapshotSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const evaluateRetentionHealth = ({
  abandonedCheckoutValue,
  anonymousCartValue,
  now = new Date(),
  redisAvailable,
}: {
  abandonedCheckoutValue: string | null
  anonymousCartValue: string | null
  now?: Date
  redisAvailable: boolean
}): RetentionHealthPayload => {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Retention health evaluation time must be valid")
  }

  const reasons = new Set<string>()
  if (!redisAvailable) {
    reasons.add("redis_unavailable")
  }
  const jobs: RetentionHealthPayload["jobs"] = {
    anonymous_cart: parseSnapshot(anonymousCartValue),
    abandoned_checkout: parseSnapshot(abandonedCheckoutValue),
  }
  for (const job of retentionJobNames) {
    const snapshot = jobs[job]
    if (!snapshot) {
      reasons.add(`${job}_heartbeat_missing`)
      continue
    }
    const ageSeconds =
      (now.getTime() - Date.parse(snapshot.recorded_at)) / 1_000
    if (ageSeconds < -RETENTION_MAX_CLOCK_SKEW_SECONDS) {
      reasons.add(`${job}_heartbeat_from_future`)
    }
    if (ageSeconds > RETENTION_MAX_HEARTBEAT_AGE_SECONDS) {
      reasons.add(`${job}_heartbeat_stale`)
    }
    if (snapshot.status === "failed") {
      reasons.add(`${job}_latest_failed`)
    }
  }

  const reasonList = [...reasons].toSorted()
  return {
    checked_at: now.toISOString(),
    jobs,
    observation_window_seconds: RETENTION_HEALTH_TTL_SECONDS,
    reasons: reasonList,
    redis: redisAvailable ? "ok" : "error",
    schema_version: 1,
    status: reasonList.length === 0 ? "healthy" : "degraded",
  }
}

export const readRetentionHealth =
  async (): Promise<RetentionHealthPayload> => {
    try {
      const client = await getSharedRedisClient()
      if (!client) {
        return evaluateRetentionHealth({
          abandonedCheckoutValue: null,
          anonymousCartValue: null,
          redisAvailable: false,
        })
      }
      const [ping, anonymousCartValue, abandonedCheckoutValue] =
        await withRedisTimeout(
          Promise.all([
            client.ping(),
            client.get(ANONYMOUS_CART_RETENTION_HEALTH_KEY),
            client.get(ABANDONED_CHECKOUT_RETENTION_HEALTH_KEY),
          ])
        )
      return evaluateRetentionHealth({
        abandonedCheckoutValue,
        anonymousCartValue,
        redisAvailable: ping === "PONG",
      })
    } catch {
      return evaluateRetentionHealth({
        abandonedCheckoutValue: null,
        anonymousCartValue: null,
        redisAvailable: false,
      })
    }
  }
