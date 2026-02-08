import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { calculateTaxes } from "@/lib/cart/api"
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
      key: "api:cart:taxes",
      max: 60,
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
    const cart = await calculateTaxes(cartId)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to calculate taxes")
    return jsonApiError("Unable to calculate taxes right now.", 500)
  }
}
