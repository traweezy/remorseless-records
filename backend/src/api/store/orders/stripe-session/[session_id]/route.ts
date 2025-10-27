import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import type {
  ICartModuleService,
  IOrderModuleService,
} from "@medusajs/framework/types"
import type Stripe from "stripe"

import { getStripeClient } from "../../../../../lib/stripe"

type OrderSummaryItem = {
  id: string
  title: string
  quantity: number
  unit_price: number
  total: number
}

type OrderSummary = {
  id: string
  display_id: number
  email?: string
  currency_code: string
  total: number
  subtotal: number
  tax_total: number
  discount_total: number
  shipping_total: number
  created_at: Date | string | undefined
  items: OrderSummaryItem[]
}

type KnownCheckoutStatus = "paid" | "failed" | "expired" | "processing"

const stripe = getStripeClient()

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { session_id: sessionId } = req.params ?? {}

  if (!sessionId || typeof sessionId !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "session_id path parameter is required"
    )
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  })

  const cartId = session.client_reference_id

  if (!cartId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe session is missing client_reference_id"
    )
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId)
  const cartMetadata = toMetadata(cart.metadata)
  const orderId = getString(cartMetadata, "stripe_order_id")

  let orderSummary: OrderSummary | null = null
  let orderMetadata: Record<string, unknown> = {}

  if (orderId) {
    const order = await orderModule.retrieveOrder(orderId, {
      relations: ["items"],
    })

    orderMetadata = toMetadata(order.metadata)

    orderSummary = {
      id: order.id,
      display_id: order.display_id,
      ...(order.email ? { email: order.email } : {}),
      currency_code: order.currency_code,
      total: Number(order.total ?? 0),
      subtotal: Number(order.subtotal ?? 0),
      tax_total: Number(order.tax_total ?? 0),
      discount_total: Number(order.discount_total ?? 0),
      shipping_total: Number(order.shipping_total ?? 0),
      created_at: order.created_at,
      items:
        order.items?.map((item) => ({
          id: item.id,
          title: item.title ?? "Item",
          quantity: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          total: Number(item.total ?? 0),
        })) ?? [],
    }
  }

  const combinedMetadata = { ...cartMetadata, ...orderMetadata }

  const checkoutStatus = deriveCheckoutStatus(
    combinedMetadata,
    session.payment_status
  )

  const lastError =
    getString(combinedMetadata, "stripe_checkout_last_error") ??
    getString(combinedMetadata, "stripe_payment_intent_last_error") ??
    null

  const lastErrorCode =
    getString(combinedMetadata, "stripe_checkout_last_error_code") ??
    getString(combinedMetadata, "stripe_payment_intent_last_error_code") ??
    null

  const paymentIntentId =
    getString(combinedMetadata, "stripe_payment_intent_id") ??
    (typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null)

  const refund = extractRefundMetadata(orderMetadata)

  res.status(200).json({
    cart_id: cart.id,
    stripe_checkout_status: checkoutStatus,
    stripe_checkout_last_error: lastError,
    stripe_checkout_last_error_code: lastErrorCode,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_last_refund: refund,
    order: orderSummary,
  })
}

const deriveCheckoutStatus = (
  metadata: Record<string, unknown>,
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | undefined
): KnownCheckoutStatus => {
  const raw = getString(metadata, "stripe_checkout_status")

  if (raw === "paid" || raw === "failed" || raw === "expired") {
    return raw
  }

  if (paymentStatus === "paid") {
    return "paid"
  }

  if (paymentStatus === "unpaid") {
    return "failed"
  }

  return "processing"
}

const toMetadata = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {}

const getString = (
  metadata: Record<string, unknown>,
  key: string
): string | null => {
  const value = metadata[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

const extractRefundMetadata = (
  metadata: Record<string, unknown>
): {
  id: string | null
  amount: number | null
  currency: string | null
  event_id: string | null
} | null => {
  const refundId = getString(metadata, "stripe_last_refund_id")
  const refundAmountRaw = metadata["stripe_last_refund_amount"]
  const refundCurrency = getString(metadata, "stripe_last_refund_currency")
  const eventId = getString(metadata, "stripe_last_refund_event_id")

  if (!refundId && refundAmountRaw == null && !refundCurrency && !eventId) {
    return null
  }

  const refundAmount =
    typeof refundAmountRaw === "number"
      ? refundAmountRaw
      : typeof refundAmountRaw === "string"
        ? Number.parseInt(refundAmountRaw, 10)
        : null

  return {
    id: refundId,
    amount: Number.isFinite(refundAmount) ? refundAmount : null,
    currency: refundCurrency,
    event_id: eventId,
  }
}
