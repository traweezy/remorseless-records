import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { resolveCheckoutCartIdentity } from "@/features/checkout/server/active-cart"
import {
  CheckoutStatusUnavailableError,
  fetchInternalCheckoutStatus,
} from "@/features/checkout/server/internal-status-client"
import {
  readReceiptGrant,
  setReceiptGrant,
} from "@/features/checkout/server/receipt-grant"
import { checkoutStateResponse } from "@/features/checkout/server/responses"
import { clearCartCookie } from "@/lib/cart/cookie"
import { jsonApiProblem } from "@/lib/security/route-guards"
import { guardCheckoutRead } from "@/features/checkout/server/guards"

export const GET = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutRead(request, {
    key: "status",
    max: 120,
  })
  if (guarded) {
    return guarded
  }

  try {
    const receipt = readReceiptGrant(request)
    if (receipt) {
      return checkoutStateResponse("order_confirmed")
    }

    const identity = resolveCheckoutCartIdentity(request)
    if (!identity.ok) {
      return identity.response
    }

    const status = await fetchInternalCheckoutStatus(
      identity.value.cartId,
      request
    )
    if (status.state === "order_confirmed") {
      return clearCartCookie(
        setReceiptGrant(
          checkoutStateResponse("order_confirmed"),
          status.orderId
        )
      )
    }
    const response = checkoutStateResponse(status.state)
    return status.state === "cart_missing"
      ? clearCartCookie(response)
      : response
  } catch (error: unknown) {
    return jsonApiProblem({
      request,
      status: 503,
      code: "recovery_required",
      title: "Checkout status is temporarily unavailable",
      detail:
        error instanceof CheckoutStatusUnavailableError
          ? "We could not verify the latest checkout status. Try again shortly."
          : "Secure checkout recovery is not configured.",
      instance: request.nextUrl.pathname,
    })
  }
}
