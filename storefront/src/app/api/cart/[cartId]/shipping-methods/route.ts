import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { addShippingMethod } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const shippingMethodSchema = z
  .object({
    option_id: z.string().trim().min(1),
  })
  .strict()

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:shipping-method",
      max: 90,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const { cartId } = await params
    const parsed = await parseJsonBody(request, shippingMethodSchema, {
      maxBytes: 2 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const cart = await addShippingMethod(cartId, parsed.data.option_id)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to add shipping method")
    return jsonApiError("Unable to add shipping method.", 500)
  }
}
