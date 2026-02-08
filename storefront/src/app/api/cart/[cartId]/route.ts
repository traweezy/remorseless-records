import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { getCart } from "@/lib/cart/api"
import {
  enforceRateLimit,
  jsonApiError,
  jsonApiResponse,
} from "@/lib/security/route-guards"

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") {
    return null
  }

  const typed = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }

  if (typeof typed.status === "number") {
    return typed.status
  }

  if (typeof typed.statusCode === "number") {
    return typed.statusCode
  }

  if (typeof typed.response?.status === "number") {
    return typed.response.status
  }

  return null
}

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ cartId: string }> }
): Promise<Response> => {
  try {
    noStore()
    const rateLimited = enforceRateLimit(_request, {
      key: "api:cart:get",
      max: 180,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const { cartId } = await params
    const cart = await getCart(cartId)
    return jsonApiResponse({ cart })
  } catch (error: unknown) {
    const status = getErrorStatus(error)
    if (status === 404) {
      return jsonApiResponse({ cart: null })
    }

    console.error("Failed to retrieve cart")
    return jsonApiError("Unable to retrieve cart at this time.", 500)
  }
}
