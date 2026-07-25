import type { HttpTypes } from "@medusajs/types"
import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { checkoutRevisionSchema } from "@/features/checkout/schemas/checkout"
import { resolveCheckoutCartIdentity } from "@/features/checkout/server/active-cart"
import {
  CheckoutStatusUnavailableError,
  fetchInternalCheckoutStatus,
} from "@/features/checkout/server/internal-status-client"
import {
  CheckoutPaymentError,
  assertCompletablePayment,
} from "@/features/checkout/server/payment"
import { createCheckoutProjection } from "@/features/checkout/server/projection"
import {
  CheckoutRevalidationError,
  revalidateShippingAndTaxes,
} from "@/features/checkout/server/revalidate"
import { orderConfirmedResponse } from "@/features/checkout/server/responses"
import { completeCart, getCart } from "@/lib/cart/api"
import { jsonApiProblem, parseJsonBody } from "@/lib/security/route-guards"
import { guardCheckoutMutation } from "@/features/checkout/server/guards"

const checkoutChanged = (
  request: NextRequest,
  cart: HttpTypes.StoreCart
): Response =>
  jsonApiProblem({
    status: 409,
    code: "checkout_changed",
    title: "Your order changed",
    detail: "Review the updated total before placing your order.",
    instance: request.nextUrl.pathname,
    extensions: { checkout: createCheckoutProjection(cart) },
  })

const completionProblem = (
  request: NextRequest,
  input: {
    status: number
    code: string
    title: string
    detail: string
  }
): Response =>
  jsonApiProblem({
    ...input,
    instance: request.nextUrl.pathname,
  })

const recoverUncertainCompletion = async (
  request: NextRequest,
  cartId: string
): Promise<Response> => {
  try {
    const status = await fetchInternalCheckoutStatus(cartId)
    if (status.state === "order_confirmed") {
      return orderConfirmedResponse({
        orderId: status.orderId,
      })
    }
    if (
      status.state === "finalizing_order" ||
      status.state === "payment_processing" ||
      status.state === "cart_active"
    ) {
      return completionProblem(request, {
        status: 409,
        code: "completion_in_progress",
        title: "Your order is still being finalized",
        detail:
          "Do not submit payment again. We are checking the existing attempt.",
      })
    }
    if (status.state === "payment_action_required") {
      return completionProblem(request, {
        status: 409,
        code: "payment_action_required",
        title: "Payment needs another step",
        detail: "Complete the requested payment step before trying again.",
      })
    }
    if (status.state === "payment_failed") {
      return completionProblem(request, {
        status: 402,
        code: "payment_declined",
        title: "Payment was not completed",
        detail: "No order was placed. Review payment details and try again.",
      })
    }
    return completionProblem(request, {
      status: 404,
      code: "cart_missing",
      title: "Checkout could not be found",
      detail: "This checkout is no longer available.",
    })
  } catch (error: unknown) {
    return completionProblem(request, {
      status: 503,
      code: "recovery_required",
      title: "We are verifying your order",
      detail:
        error instanceof CheckoutStatusUnavailableError
          ? "Do not submit payment again. Check this checkout again shortly."
          : "Secure checkout recovery is not configured.",
    })
  }
}

const handleCartCompletionError = (
  request: NextRequest,
  result: Extract<HttpTypes.StoreCompleteCartResponse, { type: "cart" }>
): Response => {
  if (result.error.type === "payment_requires_more_error") {
    return completionProblem(request, {
      status: 409,
      code: "payment_action_required",
      title: "Payment needs another step",
      detail: "Complete the requested payment step before trying again.",
    })
  }
  return completionProblem(request, {
    status: 402,
    code: "payment_declined",
    title: "Payment was not completed",
    detail: "No order was placed. Review payment details and try again.",
  })
}

export const POST = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutMutation(request, {
    key: "complete",
    max: 10,
  })
  if (guarded) {
    return guarded
  }

  const parsed = await parseJsonBody(request, checkoutRevisionSchema, {
    maxBytes: 2 * 1024,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  const identity = resolveCheckoutCartIdentity(request)
  if (!identity.ok) {
    return identity.response
  }

  let completionAttempted = false
  try {
    const cart = await getCart(identity.value.cartId)
    if (cart.completed_at) {
      completionAttempted = true
      const result = await completeCart(cart.id)
      if (result.type === "cart") {
        return handleCartCompletionError(request, result)
      }
      return orderConfirmedResponse({
        orderId: result.order.id,
        orderNumber:
          result.order.display_id === undefined
            ? null
            : String(result.order.display_id),
      })
    }

    const initial = createCheckoutProjection(cart)
    if (initial.revision !== parsed.data.revision) {
      return checkoutChanged(request, cart)
    }

    const revalidatedCart = await revalidateShippingAndTaxes(cart)
    const revalidated = createCheckoutProjection(revalidatedCart)
    if (revalidated.revision !== parsed.data.revision) {
      return checkoutChanged(request, revalidatedCart)
    }

    if (revalidated.cart.totals.total > 0) {
      assertCompletablePayment(revalidatedCart)
    }

    completionAttempted = true
    const result = await completeCart(revalidatedCart.id)
    if (result.type === "cart") {
      return handleCartCompletionError(request, result)
    }

    return orderConfirmedResponse({
      orderId: result.order.id,
      orderNumber:
        result.order.display_id === undefined
          ? null
          : String(result.order.display_id),
    })
  } catch (error: unknown) {
    if (completionAttempted) {
      return recoverUncertainCompletion(request, identity.value.cartId)
    }
    if (error instanceof CheckoutRevalidationError) {
      return completionProblem(request, {
        status: 409,
        code: error.code,
        title: "Delivery method changed",
        detail: error.message,
      })
    }
    if (error instanceof CheckoutPaymentError) {
      return completionProblem(request, {
        status: error.code === "payment_not_configured" ? 503 : 409,
        code: error.code,
        title: "Payment cannot be submitted",
        detail:
          error.code === "payment_not_configured"
            ? "Secure payment is temporarily unavailable."
            : "Review the updated payment details before trying again.",
      })
    }
    return completionProblem(request, {
      status: 503,
      code: "recovery_required",
      title: "Checkout is temporarily unavailable",
      detail: "Your payment was not submitted. Try again shortly.",
    })
  }
}
