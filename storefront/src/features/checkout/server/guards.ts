import "server-only"

import type { NextRequest } from "next/server"

import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"
import {
  enforceTrustedOrigin,
  jsonApiProblem,
} from "@/lib/security/route-guards"

type CheckoutRatePolicy = {
  key: string
  max: number
}

const CHECKOUT_RATE_WINDOW_MS = 60_000

const checkoutRateLimitResponse = (
  request: NextRequest,
  response: Response
): Response => {
  const rateLimited = response.status === 429
  const semanticResponse = jsonApiProblem({
    request,
    status: response.status,
    code: rateLimited ? "rate_limited" : "recovery_required",
    title: rateLimited
      ? "Too many checkout requests"
      : "Checkout is temporarily unavailable",
    detail: rateLimited
      ? "Wait a moment before trying that checkout step again."
      : "Wait a moment and try that checkout step again.",
    instance: request.nextUrl.pathname,
  })
  const retryAfter = response.headers.get("Retry-After")
  if (retryAfter) {
    semanticResponse.headers.set("Retry-After", retryAfter)
  }
  return semanticResponse
}

export const guardCheckoutRead = async (
  request: NextRequest,
  policy: CheckoutRatePolicy
): Promise<Response | null> => {
  const response = await enforceCartRateLimit(request, {
    key: `api:checkout:${policy.key}`,
    max: policy.max,
    windowMs: CHECKOUT_RATE_WINDOW_MS,
  })
  return response ? checkoutRateLimitResponse(request, response) : null
}

export const guardCheckoutMutation = async (
  request: NextRequest,
  policy: CheckoutRatePolicy
): Promise<Response | null> => {
  const rateLimited = await guardCheckoutRead(request, policy)
  if (rateLimited) {
    return rateLimited
  }
  return enforceTrustedOrigin(request)
}
