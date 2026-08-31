import {
  readCheckoutOrderLink,
  readCheckoutStatusCart,
  type CheckoutStatusCartRecord,
} from "./persistence-contracts"

export type InternalCheckoutStatus =
  | {
      state:
        | "cart_active"
        | "cart_missing"
        | "finalizing_order"
        | "payment_action_required"
        | "payment_failed"
        | "payment_processing"
    }
  | {
      state: "order_confirmed"
      orderId: string
    }

export type CheckoutStatusQueryGraph = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { take?: number; skip?: number }
  }) => Promise<unknown>
}

const paymentStatusesFrom = (cart: CheckoutStatusCartRecord): Set<string> => {
  return new Set(
    cart.paymentSessions.flatMap(({ providerId, status }) =>
      providerId === "pp_stripe_stripe" ? [status] : []
    )
  )
}

export const resolveInternalCheckoutStatus = async (
  query: CheckoutStatusQueryGraph,
  cartId: string
): Promise<InternalCheckoutStatus> => {
  const [orderLinkResult, cartResult] = await Promise.all([
    query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
      pagination: { take: 2 },
    }),
    query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.status",
      ],
      filters: { id: cartId },
      pagination: { take: 2 },
    }),
  ])

  const orderId = readCheckoutOrderLink(orderLinkResult)
  const cart = readCheckoutStatusCart(cartResult, cartId)
  if (orderId && cart?.completedAt) {
    return { state: "order_confirmed", orderId }
  }
  if (orderId) {
    // Medusa writes this link before payment authorization and before its
    // complete-cart workflow finishes. It proves that an order attempt exists,
    // not that checkout succeeded. Only a type:"order" completion response is
    // authoritative confirmation.
    return { state: "finalizing_order" }
  }

  if (!cart) {
    return { state: "cart_missing" }
  }

  const statuses = paymentStatusesFrom(cart)
  if (statuses.has("authorized") || statuses.has("captured")) {
    return { state: "finalizing_order" }
  }
  if (statuses.has("pending_authorization")) {
    return { state: "payment_processing" }
  }
  if (statuses.has("requires_more")) {
    return { state: "payment_action_required" }
  }
  if (statuses.has("error") || statuses.has("canceled")) {
    return { state: "payment_failed" }
  }
  if (cart.completedAt) {
    return { state: "finalizing_order" }
  }

  return { state: "cart_active" }
}
