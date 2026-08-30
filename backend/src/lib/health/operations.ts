import type { OperationalIncidentHealthPayload } from "./incidents"
import type { ReadinessCheck } from "./readiness"
import type { RetentionHealthPayload } from "./retention"
import type { CheckoutSchedulerHealthPayload } from "./scheduler"

const DEPENDENCY_LATENCY_THRESHOLDS_MS: Readonly<Record<string, number>> = {
  database: 1_000,
  object_storage: 3_500,
  redis: 250,
  search: 2_000,
}

export type OperationsHealthPayload = {
  checked_at: string
  components: {
    incidents: OperationalIncidentHealthPayload
    retention: RetentionHealthPayload
    scheduler: CheckoutSchedulerHealthPayload
  }
  dependencies: ReadinessCheck[]
  reasons: string[]
  schema_version: 1
  status: "degraded" | "healthy"
  version?: string
}

export const evaluateOperationsHealth = ({
  dependencies,
  incidents,
  now = new Date(),
  retention,
  scheduler,
}: {
  dependencies: ReadinessCheck[]
  incidents: OperationalIncidentHealthPayload
  now?: Date
  retention: RetentionHealthPayload
  scheduler: CheckoutSchedulerHealthPayload
}): Omit<OperationsHealthPayload, "version"> => {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Operations health evaluation time must be valid")
  }
  const reasons = new Set<string>()
  for (const reason of scheduler.reasons) {
    reasons.add(`scheduler:${reason}`)
  }
  for (const reason of retention.reasons) {
    reasons.add(`retention:${reason}`)
  }
  for (const reason of incidents.reasons) {
    reasons.add(`incidents:${reason}`)
  }
  for (const dependency of dependencies) {
    if (dependency.status !== "ok") {
      reasons.add(`dependency:${dependency.name}_error`)
      continue
    }
    const latencyThreshold = DEPENDENCY_LATENCY_THRESHOLDS_MS[dependency.name]
    if (
      latencyThreshold !== undefined &&
      dependency.duration_ms >= latencyThreshold
    ) {
      reasons.add(`dependency:${dependency.name}_latency_high`)
    }
  }
  const reasonList = [...reasons].toSorted()
  return {
    checked_at: now.toISOString(),
    components: { incidents, retention, scheduler },
    dependencies,
    reasons: reasonList,
    schema_version: 1,
    status: reasonList.length === 0 ? "healthy" : "degraded",
  }
}
