import "server-only"

import type { NextRequest } from "next/server"

import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"
import { enforceTrustedOrigin } from "@/lib/security/route-guards"

type CheckoutRatePolicy = {
  key: string
  max: number
}

const CHECKOUT_RATE_WINDOW_MS = 60_000

export const guardCheckoutRead = (
  request: NextRequest,
  policy: CheckoutRatePolicy
): Promise<Response | null> =>
  enforceCartRateLimit(request, {
    key: `api:checkout:${policy.key}`,
    max: policy.max,
    windowMs: CHECKOUT_RATE_WINDOW_MS,
  })

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
