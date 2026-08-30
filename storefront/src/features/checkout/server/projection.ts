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
import { taxQuoteIdentityFromCart } from "@/lib/cart/tax-quote"
import {
  asUnknownRecord,
  readBoundedText,
  readFiniteNumber,
  readNonNegativeSafeInteger,
  readPositiveSafeInteger,
  readRecordArray,
  type UnknownRecord,
} from "@/lib/provider-boundary"

const STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const PROCESSABLE_STATUSES = new Set([
  "pending",
  "requires_more",
  "authorized",
  "captured",
  "pending_authorization",
])
const FAILED_STATUSES = new Set(["canceled", "error"])

export class CheckoutProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckoutProjectionError"
  }
}

const text = (value: unknown): string => readBoundedText(value, 1_024) ?? ""

const optionalText = (value: unknown): string | null => text(value) || null

const optionalIdentity = (value: unknown, name: string): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const identity = readBoundedText(value)
  if (!identity) {
    throw new CheckoutProjectionError(`${name} is malformed`)
  }
  return identity
}

const scalarText = (value: unknown, name: string): string => {
  if (value === null || value === undefined) {
    return ""
  }
  const stringValue = readBoundedText(value, 128)
  if (stringValue) {
    return stringValue
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  throw new CheckoutProjectionError(`${name} is malformed`)
}

const recordsFrom = (
  value: unknown,
  name: string,
  optional = false
): UnknownRecord[] => {
  const records = readRecordArray(value, { optional })
  if (!records) {
    throw new CheckoutProjectionError(`${name} is malformed`)
  }
  return records
}

const amount = (value: unknown, name: string): number => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new CheckoutProjectionError(`${name} is unavailable`)
  }

  const parsed = readFiniteNumber(value)
  if (parsed === null || parsed < 0) {
    throw new CheckoutProjectionError(`${name} is not a valid USD amount`)
  }
  const roundingGuard = Number.EPSILON * Math.max(1, parsed)
  return Math.round((parsed + roundingGuard) * 100) / 100
}

const canonicalAmount = (value: unknown, name: string): string =>
  amount(value, name).toFixed(2)

const quantity = (value: unknown): number => {
  const parsed = readPositiveSafeInteger(value)
  if (parsed === null) {
    throw new CheckoutProjectionError("Cart item quantity is invalid")
  }
  return parsed
}

const addressFrom = (value: unknown): CheckoutAddress | null => {
  const address = asUnknownRecord(value)
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

const lineItemsFrom = (items: unknown): CheckoutItem[] =>
  recordsFrom(items, "Cart items", true).map((item) => {
    const product = asUnknownRecord(item.product)
    const variant = asUnknownRecord(item.variant)
    if (
      (item.product !== null && item.product !== undefined && !product) ||
      (item.variant !== null && item.variant !== undefined && !variant)
    ) {
      throw new CheckoutProjectionError(
        "Cart item product or variant projection is malformed"
      )
    }
    const productTitle = text(item.product_title) || text(product?.title)
    const itemId = readBoundedText(item.id)
    if (!itemId || !productTitle) {
      throw new CheckoutProjectionError("Cart item identity is unavailable")
    }

    const allowBackorder = variant?.allow_backorder
    const manageInventory = variant?.manage_inventory
    if (
      (allowBackorder !== null &&
        allowBackorder !== undefined &&
        typeof allowBackorder !== "boolean") ||
      (manageInventory !== null &&
        manageInventory !== undefined &&
        typeof manageInventory !== "boolean")
    ) {
      throw new CheckoutProjectionError("Cart item inventory is malformed")
    }
    const inventoryQuantity = readNonNegativeSafeInteger(
      variant?.inventory_quantity
    )
    if (
      variant &&
      manageInventory === true &&
      allowBackorder !== true &&
      inventoryQuantity === null
    ) {
      throw new CheckoutProjectionError("Cart item inventory is malformed")
    }
    const availableQuantity =
      !variant || allowBackorder === true || manageInventory !== true
        ? null
        : inventoryQuantity

    return {
      availableQuantity,
      id: itemId,
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
  const cartRecord = asUnknownRecord(cart)
  const [method] = recordsFrom(
    cartRecord?.shipping_methods,
    "Cart shipping methods",
    true
  )
  if (!method) {
    return null
  }
  const methodId = readBoundedText(method.id)
  const optionId = readBoundedText(method.shipping_option_id)
  if (!methodId || !optionId) {
    throw new CheckoutProjectionError("Shipping method identity is malformed")
  }

  return {
    id: methodId,
    name: text(method.name) || "Shipping",
    optionId,
    amount: amount(method.subtotal ?? method.amount, "Shipping method amount"),
  }
}

const taxCollectionModeFrom = (
  cart: HttpTypes.StoreCart
): CheckoutTotals["taxCollectionMode"] => {
  const cartRecord = asUnknownRecord(cart)
  const subjects = [
    ...recordsFrom(cartRecord?.items, "Cart tax subjects", true),
    ...recordsFrom(
      cartRecord?.shipping_methods,
      "Cart shipping tax subjects",
      true
    ),
  ]
  const hasTaxLines = subjects.some(
    (subject) =>
      recordsFrom(subject.tax_lines, "Cart tax lines", true).length > 0
  )
  if (!hasTaxLines) {
    return "unknown"
  }
  try {
    return taxQuoteIdentityFromCart(cart).collectionMode
  } catch {
    return "unknown"
  }
}

const totalsFrom = (cart: HttpTypes.StoreCart): CheckoutTotals => {
  const currencyCode = text(cart.currency_code).toLowerCase()
  const cartRecord = asUnknownRecord(cart)
  if (currencyCode !== "usd") {
    throw new CheckoutProjectionError("Checkout is configured for USD only")
  }

  return {
    taxCollectionMode: taxCollectionModeFrom(cart),
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
  const cartRecord = asUnknownRecord(cart)
  const collectionValue = cartRecord?.payment_collection
  if (collectionValue === null || collectionValue === undefined) {
    return null
  }
  const collection = asUnknownRecord(collectionValue)
  const sessionRecords = recordsFrom(
    collection?.payment_sessions,
    "Cart payment sessions",
    true
  )
  if (!collection) {
    throw new CheckoutProjectionError("Cart payment collection is malformed")
  }
  const sessions = sessionRecords.map((session) => {
    const data = asUnknownRecord(session.data)
    if (
      !readBoundedText(session.provider_id) ||
      !readBoundedText(session.status, 64) ||
      (session.data !== null && session.data !== undefined && !data)
    ) {
      throw new CheckoutProjectionError("Cart payment session is malformed")
    }
    return session as unknown as HttpTypes.StorePaymentSession
  })
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
  const data = asUnknownRecord(session?.data)
  const value = readBoundedText(data?.client_secret, 512)
  return value && /^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(value)
    ? value
    : null
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
  recordsFrom(value, "Checkout revision records", true).sort((left, right) =>
    text(left.id).localeCompare(text(right.id))
  )

const sortCanonical = <T>(values: T[]): T[] =>
  values.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  )

const canonicalTaxLine = (line: UnknownRecord) => {
  const data = asUnknownRecord(line.data)
  if (line.data !== null && line.data !== undefined && !data) {
    throw new CheckoutProjectionError("Tax quote metadata is malformed")
  }
  return {
    code: text(line.code),
    providerId: text(line.provider_id),
    quote: {
      calculationId: optionalText(data?.calculation_id),
      fingerprint: optionalText(data?.fingerprint),
      generation: scalarText(data?.generation, "Tax quote generation"),
      provider: optionalText(data?.provider),
    },
    rate: scalarText(line.rate, "Tax line rate"),
    total: canonicalAmount(line.total, "Tax line total"),
  }
}

const revisionFor = (cart: HttpTypes.StoreCart): string => {
  const cartRecord = asUnknownRecord(cart)
  if (!cartRecord) {
    throw new CheckoutProjectionError("Checkout cart projection is malformed")
  }
  const canonical = {
    currencyCode: text(cart.currency_code).toLowerCase(),
    email: text(cart.email).toLowerCase(),
    items: recordsFrom(cartRecord.items, "Checkout revision items", true)
      .sort((left, right) => text(left.id).localeCompare(text(right.id)))
      .map((item) => {
        const itemId = readBoundedText(item.id)
        const variantId = optionalIdentity(
          item.variant_id,
          "Checkout revision variant identity"
        )
        if (!itemId) {
          throw new CheckoutProjectionError(
            "Checkout revision item identity is malformed"
          )
        }
        return {
          id: itemId,
          variantId,
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
            sortableRecords(item.tax_lines).map(canonicalTaxLine)
          ),
          adjustments: sortCanonical(
            sortableRecords(item.adjustments).map((adjustment) => ({
              code: text(adjustment.code),
              amount: canonicalAmount(
                adjustment.amount,
                "Cart item adjustment"
              ),
            }))
          ),
        }
      }),
    deliveryAddress: addressFrom(cart.shipping_address),
    shippingMethods: recordsFrom(
      cartRecord.shipping_methods,
      "Checkout revision shipping methods",
      true
    )
      .sort((left, right) => text(left.id).localeCompare(text(right.id)))
      .map((method) => {
        const methodId = readBoundedText(method.id)
        const optionId = readBoundedText(method.shipping_option_id)
        if (!methodId || !optionId) {
          throw new CheckoutProjectionError(
            "Checkout revision shipping identity is malformed"
          )
        }
        return {
          optionId,
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
            sortableRecords(method.tax_lines).map(canonicalTaxLine)
          ),
          adjustments: sortCanonical(
            sortableRecords(method.adjustments).map((adjustment) => ({
              code: text(adjustment.code),
              amount: canonicalAmount(adjustment.amount, "Shipping adjustment"),
            }))
          ),
        }
      }),
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
  if (!asUnknownRecord(cart)) {
    throw new CheckoutProjectionError("Checkout cart projection is malformed")
  }
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
