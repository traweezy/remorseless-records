import { NextResponse } from "next/server"
import { z } from "zod"

import {
  applyCorrelationToResponse,
  getRequestCorrelation,
} from "@/lib/http/correlation"
import {
  consumeRateLimit,
  type RateLimitPolicy,
} from "@/lib/security/rate-limit"
import { getStorefrontRuntimeIdentity } from "@/lib/observability/runtime-identity"

type ParseBodyOptions = {
  maxBytes?: number
  requireJsonContentType?: boolean
}

type ParseBodySuccess<T> = {
  ok: true
  data: T
}

type ParseBodyFailure = {
  ok: false
  response: Response
}

type ParseBodyResult<T> = ParseBodySuccess<T> | ParseBodyFailure

type ApiProblem = {
  request: Request
  status: number
  code: string
  title: string
  detail: string
  instance?: string
  extensions?: Record<string, unknown>
}

const DEFAULT_MAX_BODY_BYTES = 32 * 1024

const deploymentIdentity = getStorefrontRuntimeIdentity()

const jsonNoStore = <T>(body: T, init?: ResponseInit): Response => {
  const response = NextResponse.json(body, init)
  response.headers.set("Cache-Control", "no-store, max-age=0")
  return response
}

const hostFromUrl = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

const resolveTrustedHosts = (request: Request): Set<string> => {
  const trusted = new Set<string>()

  const host = request.headers.get("host")?.toLowerCase()
  if (host) {
    trusted.add(host)
  }

  const requestHost = hostFromUrl(request.url)
  if (requestHost) {
    trusted.add(requestHost)
  }

  const configured = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ]

  for (const origin of configured) {
    const hostFromOrigin = hostFromUrl(origin)
    if (hostFromOrigin) {
      trusted.add(hostFromOrigin)
    }
  }

  return trusted
}

const isTrustedSourceHeader = (
  request: Request,
  headerName: "origin" | "referer"
): boolean => {
  const trustedHosts = resolveTrustedHosts(request)
  const value = request.headers.get(headerName)

  if (!value) {
    return true
  }

  const parsedHost = hostFromUrl(value)
  if (!parsedHost) {
    return false
  }

  return trustedHosts.has(parsedHost)
}

export const enforceTrustedOrigin = (request: Request): Response | null => {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite === "cross-site") {
    return jsonApiProblem({
      request,
      status: 403,
      code: "cross_site_request",
      title: "Cross-site request is not allowed",
      detail: "Cross-site requests are not allowed.",
    })
  }

  if (!request.headers.get("origin") && !request.headers.get("referer")) {
    return jsonApiProblem({
      request,
      status: 403,
      code: "request_source_required",
      title: "Request source is required",
      detail: "Request source is required.",
    })
  }

  if (!isTrustedSourceHeader(request, "origin")) {
    return jsonApiProblem({
      request,
      status: 403,
      code: "invalid_origin",
      title: "Request origin is not allowed",
      detail: "Request origin is not allowed.",
    })
  }

  if (!isTrustedSourceHeader(request, "referer")) {
    return jsonApiProblem({
      request,
      status: 403,
      code: "invalid_referer",
      title: "Request referer is not allowed",
      detail: "Request referer is not allowed.",
    })
  }

  return null
}

export const enforceRateLimit = (
  request: Request,
  policy: RateLimitPolicy
): Promise<Response | null> => {
  return consumeRateLimit(request, policy).then((decision) => {
    if (decision.status === "allowed") {
      return null
    }
    if (decision.status === "unavailable") {
      return jsonApiProblem({
        request,
        status: 503,
        code: "rate_limit_unavailable",
        title: "Service temporarily unavailable",
        detail: "Please wait a moment and try again.",
      })
    }
    const response = jsonApiProblem({
      request,
      status: 429,
      code: "rate_limit_exceeded",
      title: "Too many requests",
      detail: "Too many requests. Please try again shortly.",
    })
    response.headers.set("Retry-After", String(decision.retryAfterSeconds))
    return response
  })
}

export const parseJsonBody = async <T>(
  request: Request,
  schema: z.ZodType<T>,
  options?: ParseBodyOptions
): Promise<ParseBodyResult<T>> => {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BODY_BYTES
  const requireJsonContentType = options?.requireJsonContentType ?? true
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""

  if (requireJsonContentType && !contentType.includes("application/json")) {
    return {
      ok: false,
      response: jsonApiProblem({
        request,
        status: 415,
        code: "unsupported_media_type",
        title: "Unsupported media type",
        detail: "Content-Type must be application/json.",
      }),
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      response: jsonApiProblem({
        request,
        status: 413,
        code: "payload_too_large",
        title: "Request body is too large",
        detail: "Request body is too large.",
      }),
    }
  }

  let rawBody: string
  try {
    const reader = request.body?.getReader()
    if (!reader) {
      rawBody = ""
    } else {
      const chunks: Uint8Array[] = []
      let receivedBytes = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        receivedBytes += value.byteLength
        if (receivedBytes > maxBytes) {
          await reader.cancel()
          return {
            ok: false,
            response: jsonApiProblem({
              request,
              status: 413,
              code: "payload_too_large",
              title: "Request body is too large",
              detail: "Request body is too large.",
            }),
          }
        }
        chunks.push(value)
      }

      const body = new Uint8Array(receivedBytes)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
      rawBody = new TextDecoder().decode(body)
    }
  } catch {
    return {
      ok: false,
      response: jsonApiProblem({
        request,
        status: 400,
        code: "malformed_json",
        title: "Malformed JSON body",
        detail: "Malformed JSON body.",
      }),
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return {
      ok: false,
      response: jsonApiProblem({
        request,
        status: 400,
        code: "malformed_json",
        title: "Malformed JSON body",
        detail: "Malformed JSON body.",
      }),
    }
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const errors = Object.entries(
      z.flattenError(parsed.error).fieldErrors
    ).flatMap(([field, messages]) =>
      Array.isArray(messages)
        ? messages
            .filter((message): message is string => typeof message === "string")
            .map((message) => ({ field, message }))
        : []
    )
    return {
      ok: false,
      response: jsonApiProblem({
        request,
        status: 400,
        code: "invalid_request",
        title: "Invalid request body",
        detail: "Invalid request body.",
        extensions: { errors },
      }),
    }
  }

  return { ok: true, data: parsed.data }
}

export const jsonApiError = (
  request: Request,
  message: string,
  status: number,
  code = "request_failed"
): Response =>
  jsonApiProblem({
    request,
    status,
    code,
    title: "Request failed",
    detail: message,
  })

export const jsonApiResponse = <T>(body: T, init?: ResponseInit): Response =>
  jsonNoStore(body, init)

export const jsonApiProblem = ({
  request,
  status,
  code,
  title,
  detail,
  instance,
  extensions,
}: ApiProblem): Response => {
  const correlation = getRequestCorrelation(request)
  const resolvedInstance = instance ?? new URL(request.url).pathname
  const response = jsonNoStore(
    {
      ...extensions,
      type: `https://remorselessrecords.com/problems/${code}`,
      title,
      status,
      detail,
      code,
      instance: resolvedInstance,
      request_id: correlation.requestId,
      trace_id: correlation.traceId,
    },
    { status }
  )
  response.headers.set("Content-Type", "application/problem+json")
  applyCorrelationToResponse(response, correlation)

  if (process.env.NODE_ENV !== "test") {
    const event = JSON.stringify({
      ...deploymentIdentity,
      event: "api.problem",
      message: "Storefront API problem response",
      method: request.method,
      problem_code: code,
      request_id: correlation.requestId,
      span_id: correlation.spanId,
      status,
      trace_id: correlation.traceId,
    })
    if (status >= 500) {
      console.error(event)
    } else {
      console.info(event)
    }
  }

  return response
}
