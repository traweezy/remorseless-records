import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { removeLineItem, updateLineItem } from "@/lib/cart/api"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const updateLineItemSchema = z
  .object({
    quantity: z.coerce.number().int().min(0).max(100),
  })
  .strict()

export const PATCH = async (
  request: NextRequest,
  { params }: { params: Promise<{ cartId: string; itemId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(request, {
      key: "api:cart:item:update",
      max: 180,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const { cartId, itemId } = await params
    const parsed = await parseJsonBody(request, updateLineItemSchema, {
      maxBytes: 2 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    const nextQuantity = parsed.data.quantity
    if (nextQuantity <= 0) {
      const cart = await removeLineItem(cartId, itemId)
      return jsonApiResponse({ cart })
    }

    const cart = await updateLineItem(cartId, itemId, nextQuantity)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to update line item")
    return jsonApiError("Unable to update cart item.", 500)
  }
}

export const DELETE = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string; itemId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(_request, {
      key: "api:cart:item:remove",
      max: 120,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(_request)
    if (originCheck) {
      return originCheck
    }

    const { cartId, itemId } = await params
    const cart = await removeLineItem(cartId, itemId)
    return jsonApiResponse({ cart })
  } catch {
    console.error("Failed to remove line item")
    return jsonApiError("Unable to remove cart item.", 500)
  }
}
