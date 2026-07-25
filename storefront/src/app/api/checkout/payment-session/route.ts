import type { NextRequest } from "next/server"
import { unstable_noStore as noStore } from "next/cache"

import { checkoutRevisionSchema } from "@/features/checkout/schemas/checkout"
import {
  checkoutProjectionResponse,
  resolveActiveCheckoutCart,
} from "@/features/checkout/server/active-cart"
import { checkoutOperationError } from "@/features/checkout/server/errors"
import { guardCheckoutMutation } from "@/features/checkout/server/guards"
import {
  CheckoutPaymentError,
  assertPreparedPayment,
  paymentNeedsFinalization,
  reusablePreparedPayment,
} from "@/features/checkout/server/payment"
import { createCheckoutProjection } from "@/features/checkout/server/projection"
import {
  addShippingMethod,
  calculateTaxes,
  getCart,
  initiatePaymentSession,
  listShippingOptions,
} from "@/lib/cart/api"
import {
  jsonApiProblem,
  parseJsonBody,
} from "@/lib/security/route-guards"

const checkoutChanged = (
  request: NextRequest,
  checkout: ReturnType<typeof createCheckoutProjection>
): Response =>
  jsonApiProblem({
    status: 409,
    code: "checkout_changed",
    title: "Your order changed",
    detail: "Review the updated total before placing your order.",
    instance: request.nextUrl.pathname,
    extensions: { checkout },
  })

const paymentProblem = (
  request: NextRequest,
  error: CheckoutPaymentError
): Response =>
  jsonApiProblem({
    status: error.code === "payment_result_unknown" ? 409 : 503,
    code: error.code,
    title:
      error.code === "payment_result_unknown"
        ? "Payment is already being finalized"
        : "Payment is temporarily unavailable",
    detail:
      error.code === "payment_result_unknown"
        ? "Check the current payment status before trying again."
        : "Wait a moment and try payment again.",
    instance: request.nextUrl.pathname,
  })

export const POST = async (request: NextRequest): Promise<Response> => {
  noStore()
  const guarded = await guardCheckoutMutation(request, {
    key: "payment-session",
    max: 20,
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

  const active = await resolveActiveCheckoutCart(request)
  if (!active.ok) {
    return active.response
  }

  try {
    const initialProjection = createCheckoutProjection(active.value.cart)
    if (initialProjection.revision !== parsed.data.revision) {
      return checkoutChanged(request, initialProjection)
    }
    if (paymentNeedsFinalization(active.value.cart)) {
      throw new CheckoutPaymentError(
        "payment_result_unknown",
        "The current payment is already being finalized."
      )
    }

    const selectedOptionId =
      active.value.cart.shipping_methods?.[0]?.shipping_option_id
    if (!selectedOptionId) {
      return jsonApiProblem({
        status: 409,
        code: "shipping_changed",
        title: "Choose a delivery method",
        detail: "Select an available delivery method before payment.",
        instance: request.nextUrl.pathname,
      })
    }

    const available = await listShippingOptions(active.value.cart.id)
    const selected = available.shipping_options?.find(
      (option) =>
        option.id === selectedOptionId && !option.insufficient_inventory
    )
    if (!selected) {
      return jsonApiProblem({
        status: 409,
        code: "shipping_changed",
        title: "Delivery method changed",
        detail: "Choose an available delivery method before payment.",
        instance: request.nextUrl.pathname,
      })
    }

    await addShippingMethod(active.value.cart.id, selected.id)
    const recalculatedCart = await calculateTaxes(active.value.cart.id)
    const recalculatedProjection =
      createCheckoutProjection(recalculatedCart)
    if (recalculatedProjection.revision !== parsed.data.revision) {
      return checkoutChanged(request, recalculatedProjection)
    }

    if (recalculatedProjection.cart.totals.total === 0) {
      return checkoutProjectionResponse({
        cart: recalculatedCart,
        needsCookieRotation: active.value.needsCookieRotation,
      })
    }

    const reusable = reusablePreparedPayment(recalculatedCart)
    let preparedCart = recalculatedCart
    if (!reusable) {
      await initiatePaymentSession(
        active.value.cart.id,
        "pp_stripe_stripe",
        recalculatedCart
      )
      preparedCart = await getCart(active.value.cart.id)
    }
    assertPreparedPayment(preparedCart)

    return checkoutProjectionResponse(
      {
        cart: preparedCart,
        needsCookieRotation: active.value.needsCookieRotation,
      },
      { includeClientSecret: true }
    )
  } catch (error: unknown) {
    if (error instanceof CheckoutPaymentError) {
      return paymentProblem(request, error)
    }
    return checkoutOperationError(request, error, {
      code: "payment_not_configured",
      title: "Payment is temporarily unavailable",
      detail: "We could not prepare secure payment. Please try again.",
    })
  }
}
