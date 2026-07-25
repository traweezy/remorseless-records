export type CheckoutState =
  | "needs_contact"
  | "needs_address"
  | "needs_shipping"
  | "ready_for_payment"
  | "payment_action_required"
  | "payment_processing"
  | "finalizing_order"
  | "order_confirmed"
  | "payment_failed"
  | "recovery_required"

export type CheckoutItem = {
  availableQuantity: number | null
  id: string
  productHandle: string | null
  productTitle: string
  quantity: number
  subtotal: number
  thumbnail: string | null
  unitPrice: number
  variantTitle: string | null
}

export type CheckoutAddress = {
  firstName: string
  lastName: string
  address1: string
  address2: string | null
  city: string
  province: string
  postalCode: string
  countryCode: "us"
  phone: string | null
}

export type CheckoutShippingMethod = {
  id: string
  name: string
  optionId: string
  amount: number
}

export type CheckoutShippingOption = {
  id: string
  name: string
  description: string | null
  amount: number
  currencyCode: "usd"
  insufficientInventory: boolean
}

export type CheckoutTotals = {
  currencyCode: "usd"
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  total: number
}

export type CheckoutPayment = {
  provider: "stripe" | null
  clientSecret: string | null
  status: string | null
  canRestart: boolean
}

export type CheckoutConfirmation = {
  orderNumber: string | null
} | null

export type CheckoutProjection = {
  state: CheckoutState
  revision: string
  cart: {
    items: CheckoutItem[]
    totals: CheckoutTotals
    contact: { email: string } | null
    deliveryAddress: CheckoutAddress | null
    shippingMethod: CheckoutShippingMethod | null
  }
  payment: CheckoutPayment
  confirmation: CheckoutConfirmation
}

export type CheckoutProblemCode =
  | "address_invalid"
  | "cart_completed"
  | "cart_empty"
  | "cart_missing"
  | "checkout_changed"
  | "completion_in_progress"
  | "contact_invalid"
  | "inventory_changed"
  | "order_finalizing"
  | "payment_action_required"
  | "payment_declined"
  | "payment_not_configured"
  | "payment_processing"
  | "payment_result_unknown"
  | "payment_session_stale"
  | "rate_limited"
  | "recovery_required"
  | "shipping_changed"
  | "shipping_unavailable"
  | "tax_unavailable"

export type CheckoutProblem = {
  type: string
  title: string
  status: number
  detail: string
  code: CheckoutProblemCode
  instance?: string | undefined
  checkout?: CheckoutProjection | undefined
}

export type CheckoutReceipt = {
  orderNumber: string | null
  placedAt: string
  email: string
  items: Array<{
    id: string
    title: string
    variantTitle: string | null
    thumbnail: string | null
    quantity: number
    total: number
  }>
  deliveryAddress: {
    firstName: string
    lastName: string
    address1: string
    address2: string | null
    city: string
    province: string
    postalCode: string
    countryCode: string
  } | null
  deliveryMethod: string | null
  totals: CheckoutTotals
}
