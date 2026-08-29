import "server-only"

import type { NextRequest } from "next/server"

import { consumeRateLimit } from "@/lib/security/rate-limit"
import { jsonApiProblem } from "@/lib/security/route-guards"

type CartRateLimitPolicy = {
  key: string
  max: number
  windowMs: number
}

const unavailableResponse = (request: NextRequest): Response =>
  jsonApiProblem({
    request,
    status: 503,
    code: "cart_rate_limit_unavailable",
    title: "Cart service temporarily unavailable",
    detail: "Please wait a moment and try your cart request again.",
    instance: request.nextUrl.pathname,
  })

export const enforceCartRateLimit = async (
  request: NextRequest,
  policy: CartRateLimitPolicy
): Promise<Response | null> => {
  const readOnly = request.method === "GET" || request.method === "HEAD"
  const decision = await consumeRateLimit(request, {
    ...policy,
    onUnavailable: readOnly ? "local-fallback" : "reject",
  })

  if (decision.status === "allowed") {
    return null
  }
  if (decision.status === "limited") {
    const response = jsonApiProblem({
      request,
      status: 429,
      code: "cart_rate_limited",
      title: "Too many cart requests",
      detail: "Please wait a moment before trying your cart request again.",
      instance: request.nextUrl.pathname,
    })
    response.headers.set("Retry-After", String(decision.retryAfterSeconds))
    return response
  }

  return unavailableResponse(request)
}
