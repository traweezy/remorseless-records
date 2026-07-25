import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { guardCheckoutRead } from "@/features/checkout/server/guards"

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
  return active.ok ? checkoutProjectionResponse(active.value) : active.response
}
