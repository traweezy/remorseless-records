import "server-only"

import { getRequestCorrelation } from "@/lib/http/correlation"
import type { BrowserTelemetryPayload } from "@/lib/observability/browser-telemetry"
import { getStorefrontRuntimeIdentity } from "@/lib/observability/runtime-identity"

export const buildBrowserTelemetryEvent = (
  request: Request,
  telemetry: BrowserTelemetryPayload,
  recordedAt = new Date()
): Record<string, unknown> => {
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new TypeError("Browser telemetry time must be valid")
  }
  const correlation = getRequestCorrelation(request)
  const shared = {
    ...getStorefrontRuntimeIdentity(),
    recorded_at: recordedAt.toISOString(),
    request_id: correlation.requestId,
    span_id: correlation.spanId,
    trace_id: correlation.traceId,
  }
  return telemetry.kind === "web_vital"
    ? {
        ...shared,
        event: "browser.web_vital",
        message: "Storefront Web Vital recorded",
        metric_name: telemetry.name,
        metric_rating: telemetry.rating,
        metric_value: Number(telemetry.value.toFixed(3)),
      }
    : {
        ...shared,
        digest: telemetry.digest,
        error_scope: telemetry.scope,
        event: "browser.client_error",
        message: "Storefront client error boundary rendered",
      }
}
