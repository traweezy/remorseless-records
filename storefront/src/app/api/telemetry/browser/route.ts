import { z } from "zod"

import { buildBrowserTelemetryEvent } from "@/lib/observability/browser-event.server"
import { recordBrowserTelemetryMetric } from "@/lib/observability/metrics"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const webVitalSchema = z
  .object({
    kind: z.literal("web_vital"),
    name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    value: z.number().finite().min(0).max(60_000),
  })
  .strict()
const clientErrorSchema = z
  .object({
    digest: z.string().regex(/^(?:[A-Za-z\d_-]{1,128}|unavailable)$/u),
    kind: z.literal("client_error"),
    scope: z.enum(["application", "route"]),
  })
  .strict()
const browserTelemetrySchema = z.discriminatedUnion("kind", [
  webVitalSchema,
  clientErrorSchema,
])

export const POST = async (request: Request): Promise<Response> => {
  const invalidOrigin = enforceTrustedOrigin(request)
  if (invalidOrigin) {
    return invalidOrigin
  }
  const rateLimited = await enforceRateLimit(request, {
    key: "api:browser-telemetry",
    max: 120,
    onUnavailable: "local-fallback",
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }
  const parsed = await parseJsonBody(request, browserTelemetrySchema, {
    maxBytes: 1_024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const event = buildBrowserTelemetryEvent(request, parsed.data)
  recordBrowserTelemetryMetric(parsed.data.kind)
  const serialized = JSON.stringify(event)
  if (parsed.data.kind === "client_error") {
    console.error(serialized)
  } else {
    console.info(serialized)
  }
  return jsonApiResponse({ accepted: true }, { status: 202 })
}
