import { describe, expect, it } from "vitest"

import {
  cartAmount,
  cartEnvelopeFrom,
  cartQuantity,
  CartSnapshotError,
} from "./snapshot"

const cart = () => ({
  id: "cart_01ABC",
  currency_code: "usd",
  items: [
    {
      id: "cali_01ABC",
      product_title: "Test pressing",
      quantity: 2,
      subtotal: 48,
      total: 48,
      unit_price: 24,
      variant_id: "variant_01ABC",
      product: { id: "prod_01ABC" },
      variant: {
        id: "variant_01ABC",
        allow_backorder: false,
        inventory_quantity: 3,
        manage_inventory: true,
      },
    },
  ],
  subtotal: 48,
  total: 48,
})

describe("cart snapshot boundary", () => {
  it("accepts a bounded USD cart and a null session envelope", () => {
    expect(cartEnvelopeFrom({ cart: cart() }).cart?.id).toBe("cart_01ABC")
    expect(cartEnvelopeFrom({ cart: null })).toEqual({ cart: null })
  })

  it.each([false, [], {}, { value: true }, "2.0", "2e0", 0, 101])(
    "rejects coercive or out-of-range quantity %p",
    (quantity) => {
      expect(cartQuantity(quantity)).toBeNull()
    }
  )

  it.each([false, [], {}, Number.POSITIVE_INFINITY, -1, 1_000_000])(
    "rejects coercive or out-of-range amount %p",
    (amount) => {
      expect(cartAmount(amount)).toBeNull()
    }
  )

  it.each([
    ["missing envelope", {}],
    ["array cart", { cart: [] }],
    ["non-USD cart", { cart: { ...cart(), currency_code: "eur" } }],
    ["primitive item", { cart: { ...cart(), items: [false] } }],
    [
      "duplicate item",
      { cart: { ...cart(), items: [cart().items[0], cart().items[0]] } },
    ],
    [
      "boolean quantity",
      { cart: { ...cart(), items: [{ ...cart().items[0], quantity: true }] } },
    ],
    [
      "array variant",
      { cart: { ...cart(), items: [{ ...cart().items[0], variant: [] }] } },
    ],
    [
      "coercive inventory",
      {
        cart: {
          ...cart(),
          items: [
            {
              ...cart().items[0],
              variant: {
                ...cart().items[0]!.variant!,
                inventory_quantity: false,
              },
            },
          ],
        },
      },
    ],
    ["boolean total", { cart: { ...cart(), total: false } }],
  ])("rejects a %s", (_label, value) => {
    expect(() => cartEnvelopeFrom(value)).toThrow(CartSnapshotError)
  })
})
