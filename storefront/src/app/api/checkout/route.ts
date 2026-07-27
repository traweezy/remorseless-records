import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { guardCheckoutRead } from "@/features/checkout/server/guards"
import { jsonApiResponse } from "@/lib/security/route-guards"

const expectedEmptyCheckoutCodes = new Set([
  "cart_completed",
  "cart_empty",
  "cart_missing",
])

const emptyCheckoutResponse = (source: Response): Response => {
  const response = jsonApiResponse({ checkout: null })
  const setCookie = source.headers.get("set-cookie")
  if (setCookie) {
    response.headers.set("set-cookie", setCookie)
  }
  return response
}

export const GET = async (request: NextRequest): Promise<Response> => {
  noStore()
  const rateLimited = await guardCheckoutRead(request, {
    key: "get",
    max: 180,
  })
  if (rateLimited) {
    return rateLimited
  }

  const active = await resolveActiveCheckoutCart(request)
  if (active.ok) {
    return checkoutProjectionResponse(active.value)
  }
  return expectedEmptyCheckoutCodes.has(active.code)
    ? emptyCheckoutResponse(active.response)
    : active.response
}
