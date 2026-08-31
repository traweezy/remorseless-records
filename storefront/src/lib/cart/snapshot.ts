import type { HttpTypes } from "@medusajs/types"

import {
  asUnknownRecord,
  readBoundedText,
  readFiniteNumber,
  readNonNegativeSafeInteger,
  readPositiveSafeInteger,
  readRecordArray,
  type UnknownRecord,
} from "@/lib/provider-boundary"

const MAX_CART_ITEMS = 100
const MAX_CART_QUANTITY = 100
const MAX_CART_AMOUNT = 999_999.99

export class CartSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CartSnapshotError"
  }
}

export const cartAmount = (value: unknown): number | null => {
  const amount = readFiniteNumber(value)
  return amount !== null && amount >= 0 && amount <= MAX_CART_AMOUNT
    ? amount
    : null
}

export const cartQuantity = (value: unknown): number | null => {
  const quantity = readPositiveSafeInteger(value)
  return quantity !== null && quantity <= MAX_CART_QUANTITY ? quantity : null
}

const optionalRecord = (value: unknown, name: string): UnknownRecord | null => {
  if (value === null || value === undefined) {
    return null
  }
  const record = asUnknownRecord(value)
  if (!record) {
    throw new CartSnapshotError(`${name} is malformed.`)
  }
  return record
}

const validateOptionalAmount = (value: unknown, name: string): void => {
  if (value !== null && value !== undefined && cartAmount(value) === null) {
    throw new CartSnapshotError(`${name} is malformed.`)
  }
}

const validateItem = (item: UnknownRecord): void => {
  const itemId = readBoundedText(item.id)
  const variantId = readBoundedText(item.variant_id)
  const title =
    readBoundedText(item.product_title, 1_024) ??
    readBoundedText(item.title, 1_024)
  if (
    !itemId ||
    !/^cali_[A-Za-z0-9]+$/.test(itemId) ||
    !variantId ||
    !/^variant_[A-Za-z0-9]+$/.test(variantId) ||
    !title ||
    cartQuantity(item.quantity) === null
  ) {
    throw new CartSnapshotError(
      "A cart item identity or quantity is malformed."
    )
  }

  for (const [value, name] of [
    [item.unit_price, "A cart item unit price"],
    [item.subtotal, "A cart item subtotal"],
    [item.total, "A cart item total"],
  ] as const) {
    if (cartAmount(value) === null) {
      throw new CartSnapshotError(`${name} is malformed.`)
    }
  }

  const product = optionalRecord(item.product, "A cart item product")
  const variant = optionalRecord(item.variant, "A cart item variant")
  if (!product || !variant) {
    throw new CartSnapshotError(
      "A cart item product or variant projection is missing."
    )
  }

  for (const field of ["allow_backorder", "manage_inventory"] as const) {
    const value = variant[field]
    if (value !== null && value !== undefined && typeof value !== "boolean") {
      throw new CartSnapshotError("A cart item inventory policy is malformed.")
    }
  }

  if (
    variant.inventory_quantity !== null &&
    variant.inventory_quantity !== undefined &&
    readNonNegativeSafeInteger(variant.inventory_quantity) === null
  ) {
    throw new CartSnapshotError("A cart item inventory quantity is malformed.")
  }
}

type AssertCartSnapshot = (
  cart: UnknownRecord
) => asserts cart is UnknownRecord & HttpTypes.StoreCart

const assertCartSnapshot: AssertCartSnapshot = (cart) => {
  const cartId = readBoundedText(cart.id)
  const currencyCode = readBoundedText(cart.currency_code, 3)?.toLowerCase()
  const items = readRecordArray(cart.items)
  if (
    !cartId ||
    !/^cart_[A-Za-z0-9]+$/.test(cartId) ||
    currencyCode !== "usd" ||
    !items ||
    items.length > MAX_CART_ITEMS
  ) {
    throw new CartSnapshotError("The cart response is malformed.")
  }

  const itemIds = new Set<string>()
  let totalQuantity = 0
  for (const item of items) {
    validateItem(item)
    const itemId = readBoundedText(item.id)
    const quantity = cartQuantity(item.quantity)
    if (
      !itemId ||
      itemIds.has(itemId) ||
      quantity === null ||
      !Number.isSafeInteger(totalQuantity + quantity)
    ) {
      throw new CartSnapshotError("The cart item collection is malformed.")
    }
    itemIds.add(itemId)
    totalQuantity += quantity
  }

  for (const field of [
    "item_subtotal",
    "tax_total",
    "shipping_total",
    "shipping_subtotal",
    "discount_total",
  ] as const) {
    validateOptionalAmount(cart[field], `The cart ${field}`)
  }
  if (cartAmount(cart.subtotal) === null || cartAmount(cart.total) === null) {
    throw new CartSnapshotError("The cart subtotal or total is malformed.")
  }
}

export const cartSnapshotFrom = (value: unknown): HttpTypes.StoreCart => {
  const cart = asUnknownRecord(value)
  if (!cart) {
    throw new CartSnapshotError("The cart response is malformed.")
  }
  assertCartSnapshot(cart)
  return cart
}

export const cartEnvelopeFrom = (
  value: unknown
): { cart: HttpTypes.StoreCart | null } => {
  const envelope = asUnknownRecord(value)
  if (!envelope || !Object.hasOwn(envelope, "cart")) {
    throw new CartSnapshotError("The cart response envelope is malformed.")
  }
  return {
    cart: envelope.cart === null ? null : cartSnapshotFrom(envelope.cart),
  }
}
