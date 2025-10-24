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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutSessionCompleted(req, session, event.id)
      break
    }
    default:
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
    }),
  })
}

const extractRawBody = (req: MedusaRequest): string | undefined => {
  const raw = (req as MedusaRequest & { rawBody?: Buffer | string }).rawBody

  if (!raw) {
    return undefined
  }

  return typeof raw === "string" ? raw : raw.toString("utf8")
}
