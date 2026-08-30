import "server-only"

import { getStorefrontRuntimeIdentity } from "./runtime-identity"

export type StorefrontRuntimeEvent = {
  commit_sha: string
  environment: string
  event: string
  message: string
  recorded_at: string
  request_id: string
  service: "storefront"
  span_id: string
  trace_id: string
}

const MACHINE_EVENT_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u

export const buildStorefrontRuntimeEvent = (
  event: string,
  message: string,
  recordedAt = new Date()
): StorefrontRuntimeEvent => {
  if (!MACHINE_EVENT_PATTERN.test(event)) {
    throw new TypeError("Runtime event name must be a bounded machine code")
  }
  if (!message || message.length > 160) {
    throw new TypeError("Runtime event message must be bounded")
  }
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Runtime event time must be valid")
  }

  return {
    ...getStorefrontRuntimeIdentity(),
    event,
    message,
    recorded_at: recordedAt.toISOString(),
    request_id: "unknown",
    span_id: "unknown",
    trace_id: "unknown",
  }
}
