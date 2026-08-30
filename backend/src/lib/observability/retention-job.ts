import type { Logger } from "@medusajs/framework/types"

import {
  buildRetentionSnapshot,
  recordRetentionHealth,
  type RetentionJobName,
  type RetentionJobStatus,
  type RetentionSnapshot,
} from "../health/retention"
import { recordOperationResult } from "./operation-telemetry"
import { buildBackendRuntimeEvent } from "./runtime-event"

type RetentionLogLevel = "error" | "info" | "warn"

type RetentionJobEventInput = {
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

export const writeRetentionJobEvent = async ({
  input,
  level,
  logger,
}: {
  input: RetentionJobEventInput
  level: RetentionLogLevel
  logger: Logger
}): Promise<RetentionSnapshot> => {
  const snapshot = buildRetentionSnapshot(input)
  recordOperationResult(
    { domain: "scheduled_job", operation: "run" },
    snapshot.status === "failed" ? "error" : "ok",
    snapshot.duration_ms
  )
  try {
    await recordRetentionHealth(snapshot)
  } catch {
    logger.error(
      JSON.stringify(
        buildBackendRuntimeEvent(
          "job.retention.monitor_failed",
          "Retention health persistence failed"
        )
      )
    )
  }
  const payload = JSON.stringify(snapshot)
  logger[level](payload)
  return snapshot
}
