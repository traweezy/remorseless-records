import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const medusaMocks = vi.hoisted(() => ({
  correlatedRead: vi.fn(),
  read: vi.fn(),
}))

vi.mock("@/lib/medusa/correlated-client", () => ({
  correlatedMedusaFetch: medusaMocks.correlatedRead,
}))
vi.mock("@/lib/medusa/read-client", () => ({
  fetchMedusaStoreRead: medusaMocks.read,
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
  discount_subtotal: 0,
  shipping_subtotal: 5,
  shipping_total: 5.4,
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
    medusaMocks.read.mockResolvedValue({ order })
  })

  it("projects only customer-facing receipt fields", async () => {
    const receipt = await getOrderReceipt("order_01K123ABC")

    const [path, options] = medusaMocks.read.mock.calls[0] as unknown as [
      string,
      {
        method: string
        query: { fields: string }
      },
    ]
    expect(path).toBe("/store/orders/order_01K123ABC")
    expect(options.method).toBe("GET")
    expect(options.query.fields).toContain("*items")
    expect(options.query.fields).toContain("*items.tax_lines")
    expect(options.query.fields).toContain("item_subtotal")
    expect(options.query.fields).toContain("discount_subtotal")
    expect(options.query.fields).toContain("shipping_subtotal")
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

  it("preserves the historical disabled decision on the receipt", async () => {
    const disabledTaxLine = {
      code: "rr_tax:disabled:g3:decision",
      data: {
        collection_mode: "disabled",
        fingerprint:
          "disabledTaxFingerprint_abcdefghijklmnopqrstuvwxyz012345678",
        generation: 3,
      },
      rate: 0,
      total: 0,
    }
    medusaMocks.read.mockResolvedValue({
      order: {
        ...order,
        tax_total: 0,
        total: 24.99,
        items: order.items?.map((item) => ({
          ...item,
          tax_lines: [{ id: "ordlitax_disabled", ...disabledTaxLine }],
        })),
        shipping_methods: order.shipping_methods?.map((method) => ({
          ...method,
          tax_lines: [{ id: "ordshiptax_disabled", ...disabledTaxLine }],
        })),
      },
    })

    await expect(getOrderReceipt("order_01K123ABC")).resolves.toMatchObject({
      totals: {
        taxCollectionMode: "disabled",
        taxTotal: 0,
        total: 24.99,
      },
    })
  })

  it("uses the incoming request cancellation and correlation boundary", async () => {
    const request = new Request("https://store.test/api/checkout/confirmation")
    medusaMocks.correlatedRead.mockResolvedValue({ order })

    await expect(
      getOrderReceipt("order_01K123ABC", request)
    ).resolves.toMatchObject({ orderNumber: "1042" })

    expect(medusaMocks.correlatedRead).toHaveBeenCalledWith(
      request,
      "/store/orders/order_01K123ABC",
      expect.objectContaining({ method: "GET" })
    )
    expect(medusaMocks.read).not.toHaveBeenCalled()
  })

  it("rejects unsupported currency rather than misformatting money", async () => {
    medusaMocks.read.mockResolvedValue({
      order: { ...order, currency_code: "eur" },
    })

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow(
      "unsupported currency"
    )
  })

  it("rejects invalid line-item quantities", async () => {
    medusaMocks.read.mockResolvedValue({
      order: {
        ...order,
        items: [{ ...order.items?.[0], quantity: 0 }],
      },
    })

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow(
      "invalid quantity"
    )
  })

  it.each([
    ["coercive order number", { ...order, display_id: false }],
    ["coercive discount", { ...order, discount_subtotal: false }],
    ["incomplete timestamp", { ...order, created_at: "2026-07-25" }],
    ["primitive item row", { ...order, items: [order.items?.[0], false] }],
    [
      "coercive optional text",
      {
        ...order,
        items: [{ ...order.items?.[0], variant_title: false }],
      },
    ],
  ])("rejects a %s", async (_label, malformedOrder) => {
    medusaMocks.read.mockResolvedValue({ order: malformedOrder })

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow()
  })

  it("rejects a malformed response envelope", async () => {
    medusaMocks.read.mockResolvedValue(false)

    await expect(getOrderReceipt("order_01K123ABC")).rejects.toThrow(
      "response is malformed"
    )
  })
})
