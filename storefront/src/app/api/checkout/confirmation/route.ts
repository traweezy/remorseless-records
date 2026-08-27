import { unstable_noStore as noStore } from "next/cache"
import type { NextRequest } from "next/server"

import { guardCheckoutRead } from "@/features/checkout/server/guards"
import { getOrderReceipt } from "@/features/checkout/server/order-receipt"
import { readReceiptGrant } from "@/features/checkout/server/receipt-grant"
import { jsonApiProblem, jsonApiResponse } from "@/lib/security/route-guards"

export const GET = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutRead(request, {
    key: "confirmation",
    max: 30,
  })
  if (guarded) {
    return guarded
  }

  try {
    const receiptGrant = readReceiptGrant(request)
    if (!receiptGrant) {
      return jsonApiProblem({
        request,
        status: 404,
        code: "receipt_missing",
        title: "Receipt is unavailable",
        detail:
          "This secure receipt has expired. Check your email for the order confirmation.",
        instance: request.nextUrl.pathname,
      })
    }

    const receipt = await getOrderReceipt(receiptGrant.orderId, request)
    return jsonApiResponse({ receipt })
  } catch {
    return jsonApiProblem({
      request,
      status: 503,
      code: "receipt_unavailable",
      title: "Receipt is temporarily unavailable",
      detail:
        "Your order is confirmed, but the receipt could not be loaded. Check your email or try again.",
      instance: request.nextUrl.pathname,
    })
  }
}
