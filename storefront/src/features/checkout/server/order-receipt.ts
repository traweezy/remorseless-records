import "server-only"

import type { HttpTypes } from "@medusajs/types"

import type { CheckoutReceipt } from "@/features/checkout/types/checkout"
import { taxQuoteIdentityFromCart } from "@/lib/cart/tax-quote"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"
import {
  asUnknownRecord,
  readBoundedText,
  readFiniteNumber,
  readIsoTimestamp,
  readPositiveSafeInteger,
  readRecordArray,
} from "@/lib/provider-boundary"

const ORDER_RECEIPT_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "email",
  "currency_code",
  "item_subtotal",
  "discount_subtotal",
  "shipping_subtotal",
  "tax_total",
  "total",
  "*items",
  "*items.tax_lines",
  "*shipping_address",
  "*shipping_methods",
  "*shipping_methods.tax_lines",
].join(",")

const finiteAmount = (value: unknown): number => {
  const parsed = readFiniteNumber(value)
  if (parsed === null || parsed < 0) {
    throw new Error("Order receipt contains an invalid amount")
  }
  return parsed
}

const positiveInteger = (value: unknown): number => {
  const parsed = readPositiveSafeInteger(value)
  if (parsed === null) {
    throw new Error("Order receipt contains an invalid quantity")
  }
  return parsed
}

const requiredText = (value: unknown, field: string): string => {
  const normalized = readBoundedText(value, 1_024)
  if (!normalized) {
    throw new Error(`Order receipt is missing ${field}`)
  }
  return normalized
}

const optionalText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string") {
    throw new Error("Order receipt contains malformed optional text")
  }
  const normalized = value.trim()
  if (normalized.length > 1_024) {
    throw new Error("Order receipt contains malformed optional text")
  }
  return normalized || null
}

const receiptFromOrder = (value: unknown): CheckoutReceipt => {
  const order = asUnknownRecord(value)
  if (!order) {
    throw new Error("Order receipt projection is malformed")
  }
  const placedAt = readIsoTimestamp(order.created_at)
  if (!placedAt) {
    throw new Error("Order receipt contains an invalid timestamp")
  }

  const shippingAddress = asUnknownRecord(order.shipping_address)
  if (
    order.shipping_address !== null &&
    order.shipping_address !== undefined &&
    !shippingAddress
  ) {
    throw new Error("Order receipt delivery address is malformed")
  }
  const currencyCode = requiredText(
    order.currency_code,
    "currency"
  ).toLowerCase()
  if (currencyCode !== "usd") {
    throw new Error("Order receipt has an unsupported currency")
  }
  const shippingMethods = readRecordArray(order.shipping_methods, {
    optional: true,
  })
  const items = readRecordArray(order.items)
  if (!shippingMethods || !items || !items.length) {
    throw new Error("Order receipt relationship projection is malformed")
  }
  const deliveryMethodNames = shippingMethods
    .map((method) => optionalText(method.name))
    .filter((name): name is string => name !== null)
  const deliveryAddress = shippingAddress
    ? {
        firstName: requiredText(shippingAddress.first_name, "first name"),
        lastName: requiredText(shippingAddress.last_name, "last name"),
        address1: requiredText(shippingAddress.address_1, "address"),
        address2: optionalText(shippingAddress.address_2),
        city: requiredText(shippingAddress.city, "city"),
        province: requiredText(shippingAddress.province, "state"),
        postalCode: requiredText(shippingAddress.postal_code, "ZIP code"),
        countryCode: requiredText(
          shippingAddress.country_code,
          "country"
        ).toUpperCase(),
      }
    : null
  let taxCollectionMode: CheckoutReceipt["totals"]["taxCollectionMode"] =
    "unknown"
  try {
    taxCollectionMode = taxQuoteIdentityFromCart(order).collectionMode
  } catch {
    // Legacy orders remain readable without inventing a historical decision.
  }

  return {
    orderNumber:
      order.display_id === null || order.display_id === undefined
        ? null
        : String(positiveInteger(order.display_id)),
    placedAt,
    email: requiredText(order.email, "email"),
    items: items.map((item) => ({
      id: requiredText(item.id, "line item ID"),
      title: requiredText(item.title, "line item title"),
      variantTitle: optionalText(item.variant_title),
      thumbnail: optionalText(item.thumbnail),
      quantity: positiveInteger(item.quantity),
      total: finiteAmount(item.total),
    })),
    deliveryAddress,
    deliveryMethod:
      deliveryMethodNames.length > 0 ? deliveryMethodNames.join(", ") : null,
    totals: {
      taxCollectionMode,
      currencyCode,
      subtotal: finiteAmount(order.item_subtotal),
      discountTotal: finiteAmount(order.discount_subtotal),
      shippingTotal: finiteAmount(order.shipping_subtotal),
      taxTotal: finiteAmount(order.tax_total),
      total: finiteAmount(order.total),
    },
  }
}

export const getOrderReceipt = async (
  orderId: string,
  request?: Request
): Promise<CheckoutReceipt> => {
  const path = `/store/orders/${encodeURIComponent(orderId)}`
  const init = {
    method: "GET" as const,
    query: { fields: ORDER_RECEIPT_FIELDS },
  }
  const response: unknown = request
    ? await correlatedMedusaFetch<HttpTypes.StoreOrderResponse>(
        request,
        path,
        init
      )
    : await fetchMedusaStoreRead<HttpTypes.StoreOrderResponse>(path, init)
  const envelope = asUnknownRecord(response)
  if (!envelope) {
    throw new Error("Order receipt response is malformed")
  }
  return receiptFromOrder(envelope.order)
}
