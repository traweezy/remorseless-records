import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { addLineItem } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const addLineItemSchema = z
  .object({
    variant_id: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:item:add",
      max: 120,
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
    const parsed = await parseJsonBody(request, addLineItemSchema, {
      maxBytes: 4 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const quantity = parsed.data.quantity ?? 1
    const cart = await addLineItem(cartId, parsed.data.variant_id, quantity)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to add line item")
    return jsonApiError("Unable to add item to cart.", 500)
  }
}
