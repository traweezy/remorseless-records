import { Text, Section, Hr } from "./primitives"
import * as React from "react"
import { Base } from "./base"
import type {
  OrderNotificationAddress,
  OrderNotificationProjection,
} from "../../../lib/notifications/contracts"
import { readOrderNotificationProjection } from "../../../lib/notifications/contracts"
import { formatCurrencyAmount } from "../currency"

export const ORDER_PLACED = "order-placed"

interface OrderPlacedPreviewProps {
  order: OrderNotificationProjection["order"]
  shippingAddress: OrderNotificationAddress
}

export interface OrderPlacedTemplateProps {
  order: OrderNotificationProjection["order"]
  shippingAddress: OrderNotificationAddress
  preview?: string
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

export const isOrderPlacedTemplateData = (
  value: unknown
): value is OrderPlacedTemplateProps => {
  const data = asRecord(value)
  const order = asRecord(data?.order)
  const summary = asRecord(order?.summary)
  if (!data || !order || !summary) {
    return false
  }
  try {
    readOrderNotificationProjection(
      {
        ...order,
        customer_id: null,
        email: "template-validation@example.com",
        shipping_address: data.shippingAddress,
      },
      order.id as string
    )
  } catch {
    return false
  }
  return (
    data.preview === undefined ||
    (typeof data.preview === "string" &&
      data.preview.trim().length > 0 &&
      data.preview.length <= 255)
  )
}

export const OrderPlacedTemplate: React.FC<OrderPlacedTemplateProps> & {
  PreviewProps: OrderPlacedPreviewProps
} = ({ order, shippingAddress, preview = "Your order has been placed!" }) => {
  const formattedTotal = formatCurrencyAmount(
    order.summary.raw_current_order_total,
    order.currency_code
  )
  if (!formattedTotal) {
    throw new Error("Order confirmation contains an invalid total")
  }
  const orderItems = (order.items ?? []).map((item) => {
    const formattedUnitPrice = formatCurrencyAmount(
      item.unit_price,
      order.currency_code
    )
    if (!formattedUnitPrice) {
      throw new Error("Order confirmation contains an invalid item price")
    }
    return { formattedUnitPrice, item }
  })

  return (
    <Base preview={preview}>
      <Section>
        <Text
          style={{
            fontSize: "24px",
            fontWeight: "bold",
            textAlign: "center",
            margin: "0 0 30px",
          }}
        >
          Order Confirmation
        </Text>

        <Text style={{ margin: "0 0 15px" }}>
          Dear {shippingAddress.first_name}
          {shippingAddress.last_name ? ` ${shippingAddress.last_name}` : ""},
        </Text>

        <Text style={{ margin: "0 0 30px" }}>
          Thank you for your recent order! Here are your order details:
        </Text>

        <Text
          style={{ fontSize: "18px", fontWeight: "bold", margin: "0 0 10px" }}
        >
          Order Summary
        </Text>
        <Text style={{ margin: "0 0 5px" }}>Order ID: {order.display_id}</Text>
        <Text style={{ margin: "0 0 5px" }}>
          Order Date: {new Date(order.created_at).toLocaleDateString()}
        </Text>
        <Text style={{ margin: "0 0 20px" }}>Total: {formattedTotal}</Text>

        <Hr style={{ margin: "20px 0" }} />

        <Text
          style={{ fontSize: "18px", fontWeight: "bold", margin: "0 0 10px" }}
        >
          Shipping Address
        </Text>
        <Text style={{ margin: "0 0 5px" }}>{shippingAddress.address_1}</Text>
        <Text style={{ margin: "0 0 5px" }}>
          {shippingAddress.city}
          {shippingAddress.province ? `, ${shippingAddress.province}` : ""}{" "}
          {shippingAddress.postal_code}
        </Text>
        <Text style={{ margin: "0 0 20px" }}>
          {shippingAddress.country_code}
        </Text>

        <Hr style={{ margin: "20px 0" }} />

        <Text
          style={{ fontSize: "18px", fontWeight: "bold", margin: "0 0 15px" }}
        >
          Order Items
        </Text>

        <div
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #ddd",
            margin: "10px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              backgroundColor: "#f2f2f2",
              padding: "8px",
              borderBottom: "1px solid #ddd",
            }}
          >
            <Text style={{ fontWeight: "bold" }}>Item</Text>
            <Text style={{ fontWeight: "bold" }}>Quantity</Text>
            <Text style={{ fontWeight: "bold" }}>Price</Text>
          </div>
          {orderItems.map(({ formattedUnitPrice, item }) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px",
                borderBottom: "1px solid #ddd",
              }}
            >
              <Text>
                {item.title} - {item.product_title}
              </Text>
              <Text>{item.quantity}</Text>
              <Text>{formattedUnitPrice}</Text>
            </div>
          ))}
        </div>
      </Section>
    </Base>
  )
}

OrderPlacedTemplate.PreviewProps = {
  order: {
    id: "order_test",
    display_id: 123,
    created_at: new Date().toISOString(),
    email: "test@example.com",
    currency_code: "USD",
    items: [
      {
        id: "ordli_1",
        title: "Item 1",
        product_title: "Product 1",
        quantity: 2,
        unit_price: 10,
      },
      {
        id: "ordli_2",
        title: "Item 2",
        product_title: "Product 2",
        quantity: 1,
        unit_price: 25,
      },
    ],
    summary: { raw_current_order_total: 45 },
  },
  shippingAddress: {
    first_name: "Test",
    last_name: "User",
    address_1: "123 Main St",
    city: "Anytown",
    province: "CA",
    postal_code: "12345",
    country_code: "US",
  },
} as OrderPlacedPreviewProps

export default OrderPlacedTemplate
