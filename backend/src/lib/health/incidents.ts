import { z } from "zod"

import { getBackendRuntimeIdentity } from "../observability/runtime-identity"
import { getSharedRedisClient, withRedisTimeout } from "../shared-redis-client"

export const operationalIncidentTypes = [
  "payment_tax_mismatch",
  "webhook_failure",
] as const
export type OperationalIncidentType = (typeof operationalIncidentTypes)[number]

export const OPERATIONAL_INCIDENT_TTL_SECONDS = 24 * 60 * 60
const incidentKey = (type: OperationalIncidentType): string =>
  `rr:health:incident:${type}:latest:v1`

const incidentSnapshotSchema = z.object({
  commit_sha: z.union([
    z.string().regex(/^[0-9a-f]{40}$/u),
    z.literal("unknown"),
  ]),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  event: z.literal("operations.incident.recorded"),
  incident_type: z.enum(operationalIncidentTypes),
  message: z.literal("Operational incident recorded"),
  recorded_at: z.string().datetime({ offset: true }),
  schema_version: z.literal(1),
  service: z.literal("backend"),
})

export type OperationalIncidentSnapshot = z.infer<typeof incidentSnapshotSchema>

export type OperationalIncidentHealthPayload = {
  checked_at: string
  incidents: OperationalIncidentSnapshot[]
  observation_window_seconds: number
  reasons: string[]
  redis: "error" | "ok"
  schema_version: 1
  status: "degraded" | "healthy"
}

export const buildOperationalIncidentSnapshot = (
  incidentType: OperationalIncidentType,
  recordedAt = new Date()
): OperationalIncidentSnapshot => {
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Operational incident time must be valid")
  }
  return incidentSnapshotSchema.parse({
    ...getBackendRuntimeIdentity(),
    event: "operations.incident.recorded",
    incident_type: incidentType,
    message: "Operational incident recorded",
    recorded_at: recordedAt.toISOString(),
    schema_version: 1,
  })
}

export const recordOperationalIncident = async (
  incidentType: OperationalIncidentType
): Promise<boolean> => {
  const snapshot = buildOperationalIncidentSnapshot(incidentType)
  const client = await getSharedRedisClient()
  if (!client) {
    return false
  }
  await withRedisTimeout(
    client.set(incidentKey(incidentType), JSON.stringify(snapshot), {
      EX: OPERATIONAL_INCIDENT_TTL_SECONDS,
    })
  )
  return true
}

const parseIncident = (
  value: string | null
): OperationalIncidentSnapshot | null => {
  if (value === null) {
    return null
  }
  try {
    const parsed = incidentSnapshotSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const evaluateOperationalIncidentHealth = ({
  incidentValues,
  now = new Date(),
  redisAvailable,
}: {
  incidentValues: Array<string | null>
  now?: Date
  redisAvailable: boolean
}): OperationalIncidentHealthPayload => {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Operational incident evaluation time must be valid")
  }
  const reasons = new Set<string>()
  if (!redisAvailable) {
    reasons.add("redis_unavailable")
  }
  const incidents = incidentValues
    .map(parseIncident)
    .filter((value): value is OperationalIncidentSnapshot => value !== null)
    .toSorted((left, right) =>
      left.incident_type.localeCompare(right.incident_type)
    )
  for (const incident of incidents) {
    reasons.add(`incident_${incident.incident_type}`)
  }
  const reasonList = [...reasons].toSorted()
  return {
    checked_at: now.toISOString(),
    incidents,
    observation_window_seconds: OPERATIONAL_INCIDENT_TTL_SECONDS,
    reasons: reasonList,
    redis: redisAvailable ? "ok" : "error",
    schema_version: 1,
    status: reasonList.length === 0 ? "healthy" : "degraded",
  }
}

export const readOperationalIncidentHealth =
  async (): Promise<OperationalIncidentHealthPayload> => {
    try {
      const client = await getSharedRedisClient()
      if (!client) {
        return evaluateOperationalIncidentHealth({
          incidentValues: [],
          redisAvailable: false,
        })
      }
      const [ping, ...incidentValues] = await withRedisTimeout(
        Promise.all([
          client.ping(),
          ...operationalIncidentTypes.map((type) =>
            client.get(incidentKey(type))
          ),
        ])
      )
      return evaluateOperationalIncidentHealth({
        incidentValues,
        redisAvailable: ping === "PONG",
      })
    } catch {
      return evaluateOperationalIncidentHealth({
        incidentValues: [],
        redisAvailable: false,
      })
    }
  }
