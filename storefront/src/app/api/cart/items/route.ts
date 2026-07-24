import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { addLineItem, createCart, getCart } from "@/lib/cart/api"
import { setCartCookie } from "@/lib/cart/cookie"
import { mapCartError } from "@/lib/cart/errors"
import { runIdempotentCartMutation } from "@/lib/cart/idempotency"
import { readOrCreateCartId } from "@/lib/cart/route"
import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"
import {
  enforceTrustedOrigin,
  jsonApiProblem,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const addLineItemSchema = z
  .object({
    variant_id: z
      .string()
      .trim()
      .regex(/^variant_[A-Za-z0-9]+$/)
      .max(100),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()

const addToFreshCart = async (
  variantId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const cart = await createCart()
  return addLineItem(cart.id, variantId, quantity)
}

export const POST = async (request: NextRequest): Promise<Response> => {
  noStore()
  const rateLimited = await enforceCartRateLimit(request, {
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

  const parsed = await parseJsonBody(request, addLineItemSchema, {
    maxBytes: 4 * 1024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const quantity = parsed.data.quantity ?? 1
  try {
    const result = await runIdempotentCartMutation({
      request,
      operation: "cart.item.add",
      payload: {
        variantId: parsed.data.variant_id,
        quantity,
      },
      execute: async () => {
        const active = await readOrCreateCartId(request)
        try {
          return await addLineItem(
            active.cartId,
            parsed.data.variant_id,
            quantity
          )
        } catch (error: unknown) {
          const problem = mapCartError(
            error,
            "Unable to add this item to the cart."
          )
          if (problem.status !== 404 || active.created) {
            throw error
          }

          return addToFreshCart(parsed.data.variant_id, quantity)
        }
      },
      replay: getCart,
    })
    if (!result.ok) {
      return result.response
    }

    const response = setCartCookie(
      jsonApiResponse({ cart: result.cart }),
      result.cart.id
    )
    if (result.replayed) {
      response.headers.set("Idempotency-Replayed", "true")
    }
    return response
  } catch (error: unknown) {
    const problem = mapCartError(error, "Unable to add this item to the cart.")
    console.error("Failed to add line item", { code: problem.code })
    return jsonApiProblem({
      ...problem,
      instance: request.nextUrl.pathname,
    })
  }
}
