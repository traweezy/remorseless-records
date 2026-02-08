import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { listShippingOptions } from "@/lib/cart/api"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:shipping-options",
      max: 120,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const { cartId } = await params
    const response = await listShippingOptions(cartId)
    return jsonApiResponse({
      shipping_options: response.shipping_options ?? [],
    })
  } catch {
    console.error("Failed to load shipping options")
    return jsonApiError("Unable to load shipping options.", 500)
  }
}
