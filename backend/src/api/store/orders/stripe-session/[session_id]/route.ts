import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import type {
  ICartModuleService,
  IOrderModuleService,
} from "@medusajs/framework/types"

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
      "Stripe session is missing client reference id"
    )
  }

  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART)
  const orderModule = req.scope.resolve<IOrderModuleService>(Modules.ORDER)

  const cart = await cartModule.retrieveCart(cartId, {
    relations: ["items"],
  })

  const cartMetadata = (cart.metadata ?? {}) as Record<string, unknown>
  const orderId = cartMetadata.stripe_order_id as string | undefined

  if (!orderId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No order associated with provided session"
    )
  }

  const order = await orderModule.retrieveOrder(orderId, {
    relations: ["items"],
  })

  const summary: OrderSummary = {
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

  res.status(200).json({ order: summary, cart_id: cart.id })
}
