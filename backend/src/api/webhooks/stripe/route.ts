import type Stripe from "stripe"

import {
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework"
import {
  Modules,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  type ICartModuleService,
  type IOrderModuleService,
} from "@medusajs/framework/types"
import { completeCartWorkflow } from "@medusajs/core-flows"

import { getStripeClient } from "../../../lib/stripe"
import { STRIPE_WEBHOOK_SECRET } from "../../../lib/constants"
import { assertValue } from "../../../utils/assert-value"
import { mergeMetadata } from "../../../lib/metadata"

const stripeWebhookSecret = assertValue(
  STRIPE_WEBHOOK_SECRET,
  "STRIPE_WEBHOOK_SECRET must be set to handle Stripe webhooks"
)

const stripe = getStripeClient()
type Logger = Pick<typeof console, "info" | "warn" | "error">

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const signature = req.headers["stripe-signature"]
  if (!signature) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing Stripe signature header"
    )
  }

  const rawBody = extractRawBody(req)

  let event: Stripe.Event

  if (rawBody) {
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        stripeWebhookSecret
      )
    } catch {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unable to verify Stripe webhook signature"
      )
    }
  } else {
    const body = req.body as { id?: unknown }
    if (!body?.id || typeof body.id !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unable to verify Stripe webhook payload"
      )
    }

    event = await stripe.events.retrieve(body.id, {
      expand: ["data.object"],
    })
  }

  const logger = getLogger(req)

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutSessionCompleted(req, session, event.id)
      break
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutSessionCompleted(req, session, event.id)
      break
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutSessionFailure(req, session, event.id)
      break
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutSessionExpired(req, session, event.id)
      break
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      await handlePaymentIntentFailed(req, paymentIntent, event.id)
      break
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge
      await handleChargeRefunded(req, charge, event.id)
      break
    }
    default:
      logger.info?.(
        `[stripe:webhook] Ignoring unhandled event type "${event.type}" (${event.id})`
      )
      break
  }

  res.status(200).json({ received: true })
}

const handleCheckoutSessionCompleted = async (
  req: MedusaRequest,
  session: Stripe.Checkout.Session,
  eventId: string
) => {
  if (!session.client_reference_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Checkout session is missing client_reference_id"
    )
  }

  if (session.payment_status !== "paid") {
    return
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(session.client_reference_id, {
    relations: ["items", "shipping_methods"],
  })

  const alreadyProcessed =
    cart.metadata &&
    typeof cart.metadata === "object" &&
    (cart.metadata as Record<string, unknown>)
      .stripe_checkout_completed_event_id === eventId

  if (alreadyProcessed) {
    return
  }

  if (!cart.items?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Cart ${cart.id} has no items`
    )
  }

  let orderIdFromWorkflow: string | undefined

  if (!cart.completed_at) {
    const workflow = completeCartWorkflow(req.scope)
    const { result } = await workflow.run({
      input: { id: cart.id },
    })

    orderIdFromWorkflow = result?.id

    if (orderIdFromWorkflow) {
      const order = await orderModule.retrieveOrder(orderIdFromWorkflow, {
        select: ["id", "metadata"],
      })

      await orderModule.updateOrders(orderIdFromWorkflow, {
        metadata: mergeMetadata(order.metadata, {
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
        }),
      })
    }
  }

  const orderId = orderIdFromWorkflow ?? (cart.metadata as Record<string, unknown> | undefined)?.stripe_order_id

  await cartModule.updateCarts(cart.id, {
    metadata: mergeMetadata(cart.metadata, {
      stripe_checkout_completed_event_id: eventId,
      stripe_checkout_session_id: session.id,
      ...(orderId ? { stripe_order_id: orderId } : {}),
      stripe_checkout_status: "paid",
    }),
  })
}

const handleCheckoutSessionFailure = async (
  req: MedusaRequest,
  session: Stripe.Checkout.Session,
  eventId: string
) => {
  const logger = getLogger(req)
  const cartId = session.client_reference_id

  if (!cartId) {
    logger.warn?.(
      `[stripe:webhook] checkout.session.async_payment_failed missing client_reference_id (event ${eventId})`
    )
    return
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId)

  let failureMessage = "Unknown payment failure"
  let failureCode: string | undefined

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["last_payment_error"] }
      )

      const lastError = paymentIntent.last_payment_error
      failureMessage = lastError?.message ?? failureMessage
      failureCode = lastError?.code ?? undefined
    } catch (error) {
      logger.warn?.(
        `[stripe:webhook] Unable to retrieve payment intent ${paymentIntentId} for failed session ${session.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      )
    }
  }

  await cartModule.updateCarts(cart.id, {
    metadata: mergeMetadata(cart.metadata, {
      stripe_checkout_last_event_id: eventId,
      stripe_checkout_session_id: session.id,
      stripe_checkout_status: "failed",
      stripe_checkout_last_error: failureMessage,
      ...(failureCode ? { stripe_checkout_last_error_code: failureCode } : {}),
    }),
  })

  const orderId = getOrderIdFromMetadata(cart.metadata)
  if (orderId) {
    const orderModuleMetadataSource = await orderModule.retrieveOrder(orderId)

    await orderModule.updateOrders(orderId, {
      metadata: mergeMetadata(orderModuleMetadataSource.metadata, {
        stripe_checkout_last_event_id: eventId,
        stripe_checkout_status: "failed",
        stripe_checkout_last_error: failureMessage,
        ...(failureCode ? { stripe_checkout_last_error_code: failureCode } : {}),
      }),
    })
  }

  logger.warn?.(
    `[stripe:webhook] Checkout session ${session.id} failed for cart ${cart.id}: ${failureMessage}`
  )
}

const handleCheckoutSessionExpired = async (
  req: MedusaRequest,
  session: Stripe.Checkout.Session,
  eventId: string
) => {
  const logger = getLogger(req)
  const cartId = session.client_reference_id

  if (!cartId) {
    logger.warn?.(
      `[stripe:webhook] checkout.session.expired missing client_reference_id (event ${eventId})`
    )
    return
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId)

  await cartModule.updateCarts(cart.id, {
    metadata: mergeMetadata(cart.metadata, {
      stripe_checkout_last_event_id: eventId,
      stripe_checkout_session_id: session.id,
      stripe_checkout_status: "expired",
    }),
  })

  const orderId = getOrderIdFromMetadata(cart.metadata)
  if (orderId) {
    const orderMetadataSource = await orderModule.retrieveOrder(orderId)

    await orderModule.updateOrders(orderId, {
      metadata: mergeMetadata(orderMetadataSource.metadata, {
        stripe_checkout_last_event_id: eventId,
        stripe_checkout_status: "expired",
      }),
    })
  }

  logger.info?.(
    `[stripe:webhook] Checkout session ${session.id} expired for cart ${cart.id}`
  )
}

const handlePaymentIntentFailed = async (
  req: MedusaRequest,
  paymentIntent: Stripe.PaymentIntent,
  eventId: string
) => {
  const logger = getLogger(req)
  const cartId = getCartIdFromPaymentIntent(paymentIntent)

  if (!cartId) {
    logger.warn?.(
      `[stripe:webhook] payment_intent.payment_failed missing cart metadata (event ${eventId}, payment_intent ${paymentIntent.id})`
    )
    return
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId)

  const failure = paymentIntent.last_payment_error
  const failureMessage = failure?.message ?? "Unknown payment failure"
  const failureCode = failure?.code

  await cartModule.updateCarts(cart.id, {
    metadata: mergeMetadata(cart.metadata, {
      stripe_payment_intent_last_event_id: eventId,
      stripe_payment_intent_last_error: failureMessage,
      ...(failureCode ? { stripe_payment_intent_last_error_code: failureCode } : {}),
      stripe_checkout_status: "failed",
    }),
  })

  const orderId = getOrderIdFromMetadata(cart.metadata)

  if (orderId) {
    const order = await orderModule.retrieveOrder(orderId)

    await orderModule.updateOrders(orderId, {
      metadata: mergeMetadata(order.metadata, {
        stripe_payment_intent_last_event_id: eventId,
        stripe_payment_intent_last_error: failureMessage,
        ...(failureCode
          ? { stripe_payment_intent_last_error_code: failureCode }
          : {}),
        stripe_checkout_status: "failed",
      }),
    })
  }

  logger.warn?.(
    `[stripe:webhook] Payment intent ${paymentIntent.id} failed for cart ${cart.id}: ${failureMessage}`
  )
}

const handleChargeRefunded = async (
  req: MedusaRequest,
  charge: Stripe.Charge,
  eventId: string
) => {
  const logger = getLogger(req)
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id

  if (!paymentIntentId) {
    logger.warn?.(
      `[stripe:webhook] charge.refunded missing payment_intent (event ${eventId}, charge ${charge.id})`
    )
    return
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  })

  const cartId = getCartIdFromPaymentIntent(paymentIntent)

  if (!cartId) {
    logger.warn?.(
      `[stripe:webhook] charge.refunded payment_intent ${paymentIntent.id} missing cart metadata (event ${eventId})`
    )
    return
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId)

  const orderId = getOrderIdFromMetadata(cart.metadata)
  if (!orderId) {
    logger.warn?.(
      `[stripe:webhook] charge.refunded cart ${cart.id} has no associated order metadata`
    )
    return
  }

  const order = await orderModule.retrieveOrder(orderId)

  const refund = charge.refunds?.data?.[charge.refunds.data.length - 1]
  const refundAmount = typeof refund?.amount === "number" ? refund.amount : null
  const refundCurrency =
    typeof refund?.currency === "string" ? refund.currency : null

  await orderModule.updateOrders(orderId, {
    metadata: mergeMetadata(order.metadata, {
      stripe_last_refund_event_id: eventId,
      ...(refund?.id ? { stripe_last_refund_id: refund.id } : {}),
      ...(refundAmount !== null ? { stripe_last_refund_amount: refundAmount } : {}),
      ...(refundCurrency
        ? { stripe_last_refund_currency: refundCurrency.toLowerCase() }
        : {}),
    }),
  })

  logger.info?.(
    `[stripe:webhook] Recorded refund for order ${orderId} (charge ${charge.id}, amount ${refundAmount ?? "unknown"})`
  )
}

const extractRawBody = (req: MedusaRequest): string | undefined => {
  const raw = (req as MedusaRequest & { rawBody?: Buffer | string }).rawBody

  if (!raw) {
    return undefined
  }

  return typeof raw === "string" ? raw : raw.toString("utf8")
}

const getCartIdFromPaymentIntent = (
  paymentIntent: Stripe.PaymentIntent
): string | null => {
  const metadata = paymentIntent.metadata ?? {}
  const direct = metadata.cart_id || metadata.cartId

  if (typeof direct === "string" && direct.trim().length) {
    return direct.trim()
  }

  return null
}

const getOrderIdFromMetadata = (
  metadata: Record<string, unknown> | null | undefined
): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null
  }

  const value = (metadata as Record<string, unknown>).stripe_order_id

  if (typeof value === "string" && value.trim().length) {
    return value.trim()
  }

  return null
}

const getLogger = (req: MedusaRequest): Logger => {
  try {
    const resolved = req.scope.resolve("logger") as Logger | undefined
    if (resolved && typeof resolved.info === "function") {
      return resolved
    }
  } catch {
    // no-op, fall back to console
  }

  return console
}
