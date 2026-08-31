import { z } from "zod"

import {
  applyCorrelationToResponse,
  getRequestCorrelation,
} from "@/lib/http/correlation"
import { recordBrowserSecurityReportMetric } from "@/lib/observability/metrics"
import { getStorefrontRuntimeIdentity } from "@/lib/observability/runtime-identity"
import {
  enforceRateLimit,
  jsonApiProblem,
  parseJsonBody,
} from "@/lib/security/route-guards"

const legacyReportSchema = z
  .object({
    "csp-report": z
      .object({
        disposition: z.literal("report").optional(),
        "effective-directive": z.string().trim().min(1).max(128).optional(),
        "violated-directive": z.string().trim().min(1).max(256).optional(),
      })
      .passthrough(),
  })
  .strict()

const reportingApiItemSchema = z
  .object({
    body: z
      .object({
        disposition: z.literal("report"),
        effectiveDirective: z.string().trim().min(1).max(128),
      })
      .passthrough(),
    type: z.literal("csp-violation"),
  })
  .passthrough()

const trustedTypesReportSchema = z.union([
  legacyReportSchema,
  z.array(reportingApiItemSchema).min(1).max(20),
])

type TrustedTypesDirective =
  | "require-trusted-types-for"
  | "trusted-types"
  | "unknown"

const acceptedContentTypes = new Set([
  "application/csp-report",
  "application/json",
  "application/reports+json",
])

const normalizeDirective = (
  value: string | undefined
): TrustedTypesDirective => {
  const candidate = value?.trim().toLowerCase()
  if (candidate?.startsWith("require-trusted-types-for")) {
    return "require-trusted-types-for"
  }
  return candidate?.startsWith("trusted-types") ? "trusted-types" : "unknown"
}

const summarizeReport = (
  report: z.infer<typeof trustedTypesReportSchema>
): {
  count: number
  directive: TrustedTypesDirective
  format: "legacy" | "reporting-api"
} => {
  if (Array.isArray(report)) {
    const directives = new Set(
      report.map((entry) => normalizeDirective(entry.body.effectiveDirective))
    )
    return {
      count: report.length,
      directive:
        directives.size === 1
          ? (directives.values().next().value ?? "unknown")
          : "unknown",
      format: "reporting-api",
    }
  }

  return {
    count: 1,
    directive: normalizeDirective(
      report["csp-report"]["effective-directive"] ??
        report["csp-report"]["violated-directive"]
    ),
    format: "legacy",
  }
}

export const POST = async (request: Request): Promise<Response> => {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return jsonApiProblem({
      request,
      status: 403,
      code: "cross_site_request",
      title: "Cross-site request is not allowed",
      detail: "Cross-site requests are not allowed.",
    })
  }

  const rateLimited = await enforceRateLimit(request, {
    key: "api:trusted-types-report",
    max: 60,
    onUnavailable: "local-fallback",
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const contentType =
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? ""
  if (!acceptedContentTypes.has(contentType)) {
    return jsonApiProblem({
      request,
      status: 415,
      code: "unsupported_media_type",
      title: "Unsupported media type",
      detail: "Content-Type is not supported.",
    })
  }

  const parsed = await parseJsonBody(request, trustedTypesReportSchema, {
    maxBytes: 8 * 1_024,
    requireJsonContentType: false,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const summary = summarizeReport(parsed.data)
  const correlation = getRequestCorrelation(request)
  recordBrowserSecurityReportMetric(summary.directive, summary.count)
  console.warn(
    JSON.stringify({
      ...getStorefrontRuntimeIdentity(),
      event: "security.trusted_types.report",
      message: "Trusted Types report-only violation received",
      recorded_at: new Date().toISOString(),
      report_count: summary.count,
      report_directive: summary.directive,
      report_format: summary.format,
      request_id: correlation.requestId,
      span_id: correlation.spanId,
      trace_id: correlation.traceId,
    })
  )

  return applyCorrelationToResponse(
    new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }),
    correlation
  )
}
