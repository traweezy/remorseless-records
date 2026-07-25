import "server-only"

import type { HttpTypes } from "@medusajs/types"

import type { CheckoutReceipt } from "@/features/checkout/types/checkout"
import { medusa } from "@/lib/medusa/client"

const ORDER_RECEIPT_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "email",
  "currency_code",
  "subtotal",
  "item_subtotal",
  "discount_total",
  "shipping_total",
  "tax_total",
  "total",
  "*items",
  "*shipping_address",
  "*shipping_methods",
].join(",")

const ORDER_RECEIPT_TIMEOUT_MS = 8_000

const finiteAmount = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Order receipt contains an invalid amount")
  }
  return value
}

const positiveInteger = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Order receipt contains an invalid quantity")
  }
  return value
}

const requiredText = (
  value: string | null | undefined,
  field: string
): string => {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`Order receipt is missing ${field}`)
  }
  return normalized
}

const optionalText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }
  return normalized
}

const receiptFromOrder = (order: HttpTypes.StoreOrder): CheckoutReceipt => {
  const placedAt = new Date(order.created_at)
  if (Number.isNaN(placedAt.valueOf())) {
    throw new Error("Order receipt contains an invalid timestamp")
  }

  const shippingAddress = order.shipping_address
  const currencyCode = requiredText(
    order.currency_code,
    "currency"
  ).toLowerCase()
  if (currencyCode !== "usd") {
    throw new Error("Order receipt has an unsupported currency")
  }
  const deliveryMethodNames =
    order.shipping_methods
      ?.map((method) => optionalText(method.name))
      .filter((name): name is string => name !== null) ?? []
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

  return {
    orderNumber:
      order.display_id === undefined ? null : String(order.display_id),
    placedAt: placedAt.toISOString(),
    email: requiredText(order.email, "email"),
    items: (order.items ?? []).map((item) => ({
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
      currencyCode,
      subtotal: finiteAmount(order.item_subtotal),
      discountTotal: finiteAmount(order.discount_total),
      shippingTotal: finiteAmount(order.shipping_total),
      taxTotal: finiteAmount(order.tax_total),
      total: finiteAmount(order.total),
    },
  }
}

export const getOrderReceipt = async (
  orderId: string
): Promise<CheckoutReceipt> => {
  const { order } = await medusa.client.fetch<HttpTypes.StoreOrderResponse>(
    `/store/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      query: { fields: ORDER_RECEIPT_FIELDS },
      signal: AbortSignal.timeout(ORDER_RECEIPT_TIMEOUT_MS),
    }
  )
  return receiptFromOrder(order)
}
