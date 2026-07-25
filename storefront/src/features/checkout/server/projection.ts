import "server-only"

import { createHash } from "node:crypto"

import type { HttpTypes } from "@medusajs/types"

import type {
  CheckoutAddress,
  CheckoutItem,
  CheckoutPayment,
  CheckoutProjection,
  CheckoutShippingMethod,
  CheckoutState,
  CheckoutTotals,
} from "@/features/checkout/types/checkout"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const PROCESSABLE_STATUSES = new Set([
  "pending",
  "requires_more",
  "authorized",
  "captured",
  "pending_authorization",
])
const FAILED_STATUSES = new Set(["canceled", "error"])

type UnknownRecord = Record<string, unknown>

export class CheckoutProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckoutProjectionError"
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const optionalText = (value: unknown): string | null => text(value) || null

const scalarText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : ""

const amount = (value: unknown, name: string): number => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new CheckoutProjectionError(`${name} is unavailable`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CheckoutProjectionError(`${name} is not a valid USD amount`)
  }
  const roundingGuard = Number.EPSILON * Math.max(1, parsed)
  return Math.round((parsed + roundingGuard) * 100) / 100
}

const canonicalAmount = (value: unknown, name: string): string =>
  amount(value, name).toFixed(2)

const quantity = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CheckoutProjectionError("Cart item quantity is invalid")
  }
  return parsed
}

const addressFrom = (value: unknown): CheckoutAddress | null => {
  const address = asRecord(value)
  if (!address) {
    return null
  }

  const countryCode = text(address.country_code).toLowerCase()
  const firstName = text(address.first_name)
  const lastName = text(address.last_name)
  const address1 = text(address.address_1)
  const city = text(address.city)
  const province = text(address.province).toUpperCase()
  const postalCode = text(address.postal_code)
  if (
    !firstName ||
    !lastName ||
    !address1 ||
    !city ||
    !province ||
    !postalCode ||
    countryCode !== "us"
  ) {
    return null
  }

  return {
    firstName,
    lastName,
    address1,
    address2: optionalText(address.address_2),
    city,
    province,
    postalCode,
    countryCode,
    phone: optionalText(address.phone),
  }
}

const lineItemsFrom = (items: HttpTypes.StoreCart["items"]): CheckoutItem[] =>
  (items ?? []).map((item) => {
    const product = asRecord(item.product)
    const variant = asRecord(item.variant)
    const productTitle = text(item.product_title) || text(product?.title)
    if (!item.id || !productTitle) {
      throw new CheckoutProjectionError("Cart item identity is unavailable")
    }

    const rawInventoryQuantity = Number(variant?.inventory_quantity)
    const availableQuantity =
      variant?.allow_backorder === true || variant?.manage_inventory === false
        ? null
        : Number.isFinite(rawInventoryQuantity)
          ? Math.max(0, Math.trunc(rawInventoryQuantity))
          : null

    return {
      availableQuantity,
      id: item.id,
      productHandle:
        optionalText(item.product_handle) ?? optionalText(product?.handle),
      productTitle,
      quantity: quantity(item.quantity),
      subtotal: amount(item.subtotal, "Cart item subtotal"),
      thumbnail: optionalText(item.thumbnail),
      unitPrice: amount(item.unit_price, "Cart item unit price"),
      variantTitle: optionalText(item.variant_title),
    }
  })

const shippingMethodFrom = (
  cart: HttpTypes.StoreCart
): CheckoutShippingMethod | null => {
  const method = cart.shipping_methods?.[0]
  if (!method?.id || !method.shipping_option_id) {
    return null
  }

  return {
    id: method.id,
    name: text(method.name) || "Shipping",
    optionId: method.shipping_option_id,
    amount: amount(method.subtotal ?? method.amount, "Shipping method amount"),
  }
}

const totalsFrom = (cart: HttpTypes.StoreCart): CheckoutTotals => {
  const currencyCode = text(cart.currency_code).toLowerCase()
  const cartRecord = asRecord(cart)
  if (currencyCode !== "usd") {
    throw new CheckoutProjectionError("Checkout is configured for USD only")
  }

  return {
    currencyCode,
    subtotal: amount(cart.item_subtotal, "Cart item subtotal"),
    discountTotal: amount(
      cartRecord?.discount_subtotal,
      "Cart discount subtotal"
    ),
    shippingTotal: amount(cart.shipping_subtotal, "Cart shipping subtotal"),
    taxTotal: amount(cart.tax_total, "Cart tax total"),
    total: amount(cart.total, "Cart total"),
  }
}

const paymentSessionFrom = (
  cart: HttpTypes.StoreCart
): HttpTypes.StorePaymentSession | null => {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  return (
    sessions.find(
      (session) =>
        session.provider_id === STRIPE_PROVIDER_ID &&
        PROCESSABLE_STATUSES.has(session.status)
    ) ??
    sessions.find((session) => session.provider_id === STRIPE_PROVIDER_ID) ??
    null
  )
}

const clientSecretFrom = (
  session: HttpTypes.StorePaymentSession | null
): string | null => {
  const data = asRecord(session?.data)
  return optionalText(data?.client_secret)
}

const paymentFrom = (
  cart: HttpTypes.StoreCart,
  includeClientSecret: boolean
): CheckoutPayment => {
  const session = paymentSessionFrom(cart)
  const status = session?.status ?? null
  return {
    provider: session?.provider_id === STRIPE_PROVIDER_ID ? "stripe" : null,
    clientSecret: includeClientSecret ? clientSecretFrom(session) : null,
    status,
    canRestart: status ? FAILED_STATUSES.has(status) : false,
  }
}

const stateFrom = ({
  cart,
  deliveryAddress,
  payment,
  shippingMethod,
}: {
  cart: HttpTypes.StoreCart
  deliveryAddress: CheckoutAddress | null
  payment: CheckoutPayment
  shippingMethod: CheckoutShippingMethod | null
}): CheckoutState => {
  if (!text(cart.email)) {
    return "needs_contact"
  }
  if (!deliveryAddress) {
    return "needs_address"
  }
  if (!shippingMethod) {
    return "needs_shipping"
  }
  if (payment.status && FAILED_STATUSES.has(payment.status)) {
    return "payment_failed"
  }
  if (payment.status === "requires_more") {
    return "payment_action_required"
  }
  if (payment.status === "pending_authorization") {
    return "payment_processing"
  }
  if (payment.status === "authorized" || payment.status === "captured") {
    return "finalizing_order"
  }
  return "ready_for_payment"
}

const sortableRecords = (value: unknown): UnknownRecord[] =>
  (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((record): record is UnknownRecord => record !== null)
    .sort((left, right) => text(left.id).localeCompare(text(right.id)))

const sortCanonical = <T>(values: T[]): T[] =>
  values.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  )

const revisionFor = (cart: HttpTypes.StoreCart): string => {
  const cartRecord = asRecord(cart)
  const canonical = {
    currencyCode: text(cart.currency_code).toLowerCase(),
    email: text(cart.email).toLowerCase(),
    items: [...(cart.items ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        variantId: item.variant_id ?? null,
        quantity: quantity(item.quantity),
        unitPrice: canonicalAmount(item.unit_price, "Cart item unit price"),
        subtotal: canonicalAmount(item.subtotal, "Cart item subtotal"),
        total: canonicalAmount(item.total, "Cart item total"),
        taxTotal: canonicalAmount(item.tax_total, "Cart item tax total"),
        discountTotal: canonicalAmount(
          item.discount_total,
          "Cart item discount total"
        ),
        taxLines: sortCanonical(
          sortableRecords(item.tax_lines).map((line) => ({
            code: text(line.code),
            rate: scalarText(line.rate),
            total: canonicalAmount(line.total, "Cart item tax line total"),
          }))
        ),
        adjustments: sortCanonical(
          sortableRecords(item.adjustments).map((adjustment) => ({
            code: text(adjustment.code),
            amount: canonicalAmount(adjustment.amount, "Cart item adjustment"),
          }))
        ),
      })),
    deliveryAddress: addressFrom(cart.shipping_address),
    shippingMethods: [...(cart.shipping_methods ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((method) => ({
        optionId: method.shipping_option_id ?? null,
        amount: canonicalAmount(
          method.subtotal ?? method.amount,
          "Shipping method amount"
        ),
        taxTotal: canonicalAmount(
          method.tax_total,
          "Shipping method tax total"
        ),
        total: canonicalAmount(method.total, "Shipping method total"),
        taxLines: sortCanonical(
          sortableRecords(method.tax_lines).map((line) => ({
            code: text(line.code),
            rate: scalarText(line.rate),
            total: canonicalAmount(line.total, "Shipping tax line total"),
          }))
        ),
        adjustments: sortCanonical(
          sortableRecords(method.adjustments).map((adjustment) => ({
            code: text(adjustment.code),
            amount: canonicalAmount(adjustment.amount, "Shipping adjustment"),
          }))
        ),
      })),
    totals: {
      subtotal: canonicalAmount(cart.item_subtotal, "Cart item subtotal"),
      discountTotal: canonicalAmount(
        cartRecord?.discount_subtotal,
        "Cart discount subtotal"
      ),
      shippingTotal: canonicalAmount(
        cart.shipping_subtotal,
        "Cart shipping subtotal"
      ),
      taxTotal: canonicalAmount(cart.tax_total, "Cart tax total"),
      total: canonicalAmount(cart.total, "Cart total"),
    },
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("base64url")
  return `v1.${digest}`
}

export const createCheckoutProjection = (
  cart: HttpTypes.StoreCart,
  options: { includeClientSecret?: boolean } = {}
): CheckoutProjection => {
  const items = lineItemsFrom(cart.items)
  if (!items.length) {
    throw new CheckoutProjectionError("Checkout cart is empty")
  }

  const deliveryAddress = addressFrom(cart.shipping_address)
  const shippingMethod = shippingMethodFrom(cart)
  const payment = paymentFrom(cart, options.includeClientSecret ?? false)

  return {
    state: stateFrom({
      cart,
      deliveryAddress,
      payment,
      shippingMethod,
    }),
    revision: revisionFor(cart),
    cart: {
      items,
      totals: totalsFrom(cart),
      contact: text(cart.email) ? { email: text(cart.email) } : null,
      deliveryAddress,
      shippingMethod,
    },
    payment,
    confirmation: null,
  }
}
