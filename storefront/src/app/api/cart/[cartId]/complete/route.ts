import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { completeCart } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const POST = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(_request, {
      key: "api:cart:complete",
      max: 30,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(_request)
    if (originCheck) {
      return originCheck
    }

    const { cartId } = await params
    const response = await completeCart(cartId)
    return jsonApiResponse(response)
  } catch {
    console.error("Failed to complete cart")
    return jsonApiError("Unable to complete cart.", 500)
  }
}
