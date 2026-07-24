import { NextResponse } from "next/server"
import { z } from "zod"

type RateLimitPolicy = {
  key: string
  max: number
  windowMs: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

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
  status: number
  code: string
  title: string
  detail: string
  instance?: string
}

const rateLimitBuckets = new Map<string, RateLimitBucket>()

const DEFAULT_MAX_BODY_BYTES = 32 * 1024
const MAX_RATE_LIMIT_BUCKETS = 10_000

const jsonNoStore = <T>(body: T, init?: ResponseInit): Response => {
  const response = NextResponse.json(body, init)
  response.headers.set("Cache-Control", "no-store, max-age=0")
  return response
}

const extractIp = (request: Request): string => {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) {
      return first
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) {
    return realIp
  }

  const cfIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) {
    return cfIp
  }

  return "unknown"
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
    return jsonNoStore(
      { error: "Cross-site requests are not allowed." },
      { status: 403 }
    )
  }

  if (!request.headers.get("origin") && !request.headers.get("referer")) {
    return jsonNoStore(
      { error: "Request source is required." },
      { status: 403 }
    )
  }

  if (!isTrustedSourceHeader(request, "origin")) {
    return jsonNoStore(
      { error: "Request origin is not allowed." },
      { status: 403 }
    )
  }

  if (!isTrustedSourceHeader(request, "referer")) {
    return jsonNoStore(
      { error: "Request referer is not allowed." },
      { status: 403 }
    )
  }

  return null
}

export const enforceRateLimit = (
  request: Request,
  policy: RateLimitPolicy
): Response | null => {
  const now = Date.now()
  const ip = extractIp(request)
  const key = `${policy.key}:${ip}`

  const current = rateLimitBuckets.get(key)
  if (!current || current.resetAt <= now) {
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      for (const [bucketKey, bucket] of rateLimitBuckets) {
        if (bucket.resetAt <= now) {
          rateLimitBuckets.delete(bucketKey)
        }
      }
      if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        const oldestKey = rateLimitBuckets.keys().next().value
        if (typeof oldestKey === "string") {
          rateLimitBuckets.delete(oldestKey)
        }
      }
    }
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + policy.windowMs,
    })
    return null
  }

  if (current.count >= policy.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000)
    )

    const response = jsonNoStore(
      { error: "Too many requests. Please try again shortly." },
      { status: 429 }
    )
    response.headers.set("Retry-After", String(retryAfterSeconds))
    return response
  }

  current.count += 1
  rateLimitBuckets.set(key, current)
  return null
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
      response: jsonNoStore(
        { error: "Content-Type must be application/json." },
        { status: 415 }
      ),
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      response: jsonNoStore(
        { error: "Request body is too large." },
        { status: 413 }
      ),
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
            response: jsonNoStore(
              { error: "Request body is too large." },
              { status: 413 }
            ),
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
      response: jsonNoStore({ error: "Malformed JSON body." }, { status: 400 }),
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return {
      ok: false,
      response: jsonNoStore({ error: "Malformed JSON body." }, { status: 400 }),
    }
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonNoStore(
        {
          error: "Invalid request body.",
          fields: z.flattenError(parsed.error).fieldErrors,
        },
        { status: 400 }
      ),
    }
  }

  return { ok: true, data: parsed.data }
}

export const jsonApiError = (message: string, status: number): Response =>
  jsonNoStore({ error: message }, { status })

export const jsonApiResponse = <T>(body: T, init?: ResponseInit): Response =>
  jsonNoStore(body, init)

export const jsonApiProblem = ({
  status,
  code,
  title,
  detail,
  instance,
}: ApiProblem): Response => {
  const response = jsonNoStore(
    {
      type: `https://remorselessrecords.com/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...(instance ? { instance } : {}),
    },
    { status }
  )
  response.headers.set("Content-Type", "application/problem+json")
  return response
}
