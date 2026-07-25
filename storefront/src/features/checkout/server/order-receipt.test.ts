import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const medusaMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock("@/lib/medusa/client", () => ({
  medusa: { client: { fetch: medusaMocks.fetch } },
}))

import { getOrderReceipt } from "@/features/checkout/server/order-receipt"

const order = {
  id: "order_01K123ABC",
  display_id: 1042,
  created_at: "2026-07-25T16:00:00.000Z",
  email: "buyer@example.test",
  currency_code: "usd",
  subtotal: 24.99,
  item_subtotal: 19.99,
  discount_total: 0,
  shipping_total: 5,
  tax_total: 1.75,
  total: 26.74,
  items: [
    {
      id: "ordli_test",
      title: "Test Release",
      variant_title: "LP",
      thumbnail: "https://media.example.test/release.jpg",
      quantity: 1,
      total: 19.99,
    },
  ],
  shipping_address: {
    first_name: "Ada",
    last_name: "Lovelace",
    address_1: "123 Test St",
    address_2: "",
    city: "Phoenix",
    province: "AZ",
    postal_code: "85001",
    country_code: "us",
  },
  shipping_methods: [{ name: "Standard" }],
} as unknown as HttpTypes.StoreOrder

describe("order receipt projection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    medusaMocks.fetch.mockResolvedValue({ order })
  })

  it("projects only customer-facing receipt fields", async () => {
    const receipt = await getOrderReceipt("order_01K123ABC")

    const [path, options] = medusaMocks.fetch.mock.calls[0] as unknown as [
      string,
      {
        method: string
        query: { fields: string }
        signal: AbortSignal
      },
    ]
    expect(path).toBe("/store/orders/order_01K123ABC")
    expect(options.method).toBe("GET")
    expect(options.query.fields).toContain("*items")
    expect(options.query.fields).toContain("item_subtotal")
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(receipt).toMatchObject({
      orderNumber: "1042",
      email: "buyer@example.test",
      deliveryMethod: "Standard",
      totals: {
        subtotal: 19.99,
        shippingTotal: 5,
        total: 26.74,
        currencyCode: "usd",
      },
    })
    expect(receipt).not.toHaveProperty("id")
    expect(JSON.stringify(receipt)).not.toContain("order_01K123ABC")
  })

  it("rejects unsupported currency rather than misformatting money", async () => {
    medusaMocks.fetch.mockResolvedValue({
      order: { ...order, currency_code: "eur" },
    })

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow(
      "unsupported currency"
    )
  })

  it("rejects invalid line-item quantities", async () => {
    medusaMocks.fetch.mockResolvedValue({
      order: {
        ...order,
        items: [{ ...order.items?.[0], quantity: 0 }],
      },
    })

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow(
      "invalid quantity"
    )
  })
})
