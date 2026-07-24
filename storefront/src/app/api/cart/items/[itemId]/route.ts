import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"
import { z } from "zod"

import { getCart, removeLineItem, updateLineItem } from "@/lib/cart/api"
import { mapCartError } from "@/lib/cart/errors"
import { runIdempotentCartMutation } from "@/lib/cart/idempotency"
import { readActiveCartId } from "@/lib/cart/route"
import { enforceCartRateLimit } from "@/lib/security/cart-rate-limit"
import {
  enforceTrustedOrigin,
  jsonApiProblem,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const updateLineItemSchema = z
  .object({
    quantity: z.coerce.number().int().min(0).max(100),
  })
  .strict()
const itemIdSchema = z
  .string()
  .trim()
  .regex(/^cali_[A-Za-z0-9]+$/)
  .max(100)

type RouteContext = {
  params: Promise<{ itemId: string }>
}

const prepareMutation = async (
  request: NextRequest,
  rateLimitKey: string,
  max: number
): Promise<string | Response> => {
  const rateLimited = await enforceCartRateLimit(request, {
    key: rateLimitKey,
    max,
    windowMs: 60_000,
  })
  if (rateLimited) {
    return rateLimited
  }

  const originCheck = enforceTrustedOrigin(request)
  if (originCheck) {
    return originCheck
  }

  return readActiveCartId(request)
}

export const PATCH = async (
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> => {
  noStore()
  const cartId = await prepareMutation(request, "api:cart:item:update", 180)
  if (cartId instanceof Response) {
    return cartId
  }

  const parsed = await parseJsonBody(request, updateLineItemSchema, {
    maxBytes: 2 * 1024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const parsedItemId = itemIdSchema.safeParse((await params).itemId)
  if (!parsedItemId.success) {
    return jsonApiProblem({
      status: 400,
      code: "cart_item_id_invalid",
      title: "Invalid cart item",
      detail: "A valid cart item identifier is required.",
      instance: request.nextUrl.pathname,
    })
  }
  try {
    const result = await runIdempotentCartMutation({
      request,
      operation: "cart.item.update",
      payload: {
        cartId,
        itemId: parsedItemId.data,
        quantity: parsed.data.quantity,
      },
      execute: () =>
        parsed.data.quantity === 0
          ? removeLineItem(cartId, parsedItemId.data)
          : updateLineItem(cartId, parsedItemId.data, parsed.data.quantity),
      replay: getCart,
    })
    if (!result.ok) {
      return result.response
    }
    const response = jsonApiResponse({ cart: result.cart })
    if (result.replayed) {
      response.headers.set("Idempotency-Replayed", "true")
    }
    return response
  } catch (error: unknown) {
    const problem = mapCartError(error, "Unable to update this cart item.")
    console.error("Failed to update line item", { code: problem.code })
    return jsonApiProblem({
      ...problem,
      instance: request.nextUrl.pathname,
    })
  }
}

export const DELETE = async (
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> => {
  noStore()
  const cartId = await prepareMutation(request, "api:cart:item:remove", 120)
  if (cartId instanceof Response) {
    return cartId
  }

  const parsedItemId = itemIdSchema.safeParse((await params).itemId)
  if (!parsedItemId.success) {
    return jsonApiProblem({
      status: 400,
      code: "cart_item_id_invalid",
      title: "Invalid cart item",
      detail: "A valid cart item identifier is required.",
      instance: request.nextUrl.pathname,
    })
  }
  try {
    const result = await runIdempotentCartMutation({
      request,
      operation: "cart.item.remove",
      payload: {
        cartId,
        itemId: parsedItemId.data,
      },
      execute: () => removeLineItem(cartId, parsedItemId.data),
      replay: getCart,
    })
    if (!result.ok) {
      return result.response
    }
    const response = jsonApiResponse({ cart: result.cart })
    if (result.replayed) {
      response.headers.set("Idempotency-Replayed", "true")
    }
    return response
  } catch (error: unknown) {
    const problem = mapCartError(error, "Unable to remove this cart item.")
    console.error("Failed to remove line item", { code: problem.code })
    return jsonApiProblem({
      ...problem,
      instance: request.nextUrl.pathname,
    })
  }
}
