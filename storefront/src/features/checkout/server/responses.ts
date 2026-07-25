import "server-only"

import { clearCartCookie } from "@/lib/cart/cookie"
import { jsonApiResponse } from "@/lib/security/route-guards"
import { setReceiptGrant } from "@/features/checkout/server/receipt-grant"

export const checkoutStateResponse = (state: string): Response =>
  jsonApiResponse({ checkout: { state } })

export const orderConfirmedResponse = ({
  orderId,
  orderNumber = null,
}: {
  orderId: string
  orderNumber?: string | null
}): Response => {
  const response = jsonApiResponse({
    checkout: {
      state: "order_confirmed",
      confirmation: { orderNumber },
    },
  })
  return clearCartCookie(setReceiptGrant(response, orderId))
}
