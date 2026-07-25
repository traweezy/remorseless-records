import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  CheckoutProjectionError,
  createCheckoutProjection,
} from "@/features/checkout/server/projection"

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_test",
    currency_code: "usd",
    email: "buyer@example.test",
    subtotal: 19.99,
    discount_total: 0,
    shipping_subtotal: 5,
    shipping_total: 5,
    tax_total: 2,
    total: 26.99,
    items: [
      {
        id: "cali_b",
        variant_id: "variant_b",
        product_title: "Test Release",
        product_handle: "test-release",
        variant_title: "Vinyl",
        quantity: 1,
        unit_price: 19.99,
        subtotal: 19.99,
        discount_total: 0,
        tax_total: 1.6,
        total: 21.59,
        tax_lines: [{ id: "calitax_b", code: "US", rate: 8, total: 1.6 }],
        adjustments: [],
      },
    ],
    shipping_address: {
      first_name: "Test",
      last_name: "Buyer",
      address_1: "354 Oyster Point Boulevard",
      city: "South San Francisco",
      province: "CA",
      postal_code: "94080",
      country_code: "us",
    },
    shipping_methods: [
      {
        id: "casm_b",
        name: "Standard Shipping",
        shipping_option_id: "so_standard",
        amount: 5,
        subtotal: 5,
        tax_total: 0.4,
        total: 5.4,
        tax_lines: [
          { id: "casmtax_b", code: "US", rate: 8, total: 0.4 },
        ],
        adjustments: [],
      },
    ],
    payment_collection: {
      id: "pay_col_test",
      currency_code: "usd",
      amount: 26.99,
      payment_sessions: [
        {
          id: "payses_test",
          provider_id: "pp_stripe_stripe",
          currency_code: "usd",
          amount: 26.99,
          status: "pending",
          data: { client_secret: "pi_test_secret_test" },
        },
      ],
    },
    ...overrides,
  }) as HttpTypes.StoreCart

describe("checkout projection", () => {
  it("returns a sanitized, ready checkout without a client secret by default", () => {
    const projection = createCheckoutProjection(cartFixture())

    expect(projection).toMatchObject({
      state: "ready_for_payment",
      cart: {
        contact: { email: "buyer@example.test" },
        totals: {
          currencyCode: "usd",
          subtotal: 19.99,
          shippingTotal: 5,
          taxTotal: 2,
          total: 26.99,
        },
      },
      payment: {
        provider: "stripe",
        clientSecret: null,
        status: "pending",
      },
    })
    expect(projection.revision).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(projection)).not.toContain("cart_test")
    expect(JSON.stringify(projection)).not.toContain("pay_col_test")
  })

  it("includes the client secret only for a prepared payment response", () => {
    expect(
      createCheckoutProjection(cartFixture(), {
        includeClientSecret: true,
      }).payment.clientSecret
    ).toBe("pi_test_secret_test")
  })

  it.each([
    ["needs_contact", (cart: HttpTypes.StoreCart) => {
      cart.email = ""
    }],
    ["needs_address", (cart: HttpTypes.StoreCart) => {
      cart.shipping_address!.postal_code = ""
    }],
    ["needs_shipping", (cart: HttpTypes.StoreCart) => {
      cart.shipping_methods = []
    }],
  ] as const)("derives %s from authoritative cart state", (state, mutate) => {
    const cart = cartFixture()
    mutate(cart)

    expect(createCheckoutProjection(cart).state).toBe(state)
  })

  it.each([
    ["requires_more", "payment_action_required"],
    ["pending_authorization", "payment_processing"],
    ["authorized", "finalizing_order"],
    ["captured", "finalizing_order"],
    ["error", "payment_failed"],
  ] as const)("maps %s payments to %s", (status, state) => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.status = status

    expect(createCheckoutProjection(cart).state).toBe(state)
  })

  it("keeps the revision stable when item and tax-line order changes", () => {
    const first = cartFixture()
    const second = cartFixture({
      items: [
        {
          ...first.items![0]!,
          id: "cali_a",
          variant_id: "variant_a",
        },
        first.items![0]!,
      ],
    })
    const reordered = {
      ...second,
      items: [...second.items!].reverse(),
    } as HttpTypes.StoreCart

    expect(createCheckoutProjection(second).revision).toBe(
      createCheckoutProjection(reordered).revision
    )
  })

  it("ignores regenerated shipping and tax record identifiers", () => {
    const original = cartFixture()
    const regenerated = cartFixture()
    regenerated.shipping_methods![0]!.id = "casm_regenerated"
    regenerated.shipping_methods![0]!.tax_lines![0]!.id =
      "casmtax_regenerated"
    regenerated.items![0]!.tax_lines![0]!.id = "calitax_regenerated"

    expect(createCheckoutProjection(regenerated).revision).toBe(
      createCheckoutProjection(original).revision
    )
  })

  it.each([
    ["quantity", (cart: HttpTypes.StoreCart) => {
      cart.items![0]!.quantity = 2
      cart.items![0]!.subtotal = 39.98
      cart.items![0]!.total = 41.58
      cart.subtotal = 39.98
      cart.total = 46.98
    }],
    ["shipping", (cart: HttpTypes.StoreCart) => {
      cart.shipping_methods![0]!.subtotal = 6
      cart.shipping_methods![0]!.amount = 6
      cart.shipping_methods![0]!.total = 6.4
      cart.shipping_subtotal = 6
      cart.shipping_total = 6
      cart.total = 27.99
    }],
    ["tax", (cart: HttpTypes.StoreCart) => {
      cart.tax_total = 2.01
      cart.total = 27
    }],
    ["address", (cart: HttpTypes.StoreCart) => {
      cart.shipping_address!.postal_code = "10001"
    }],
  ] as const)("changes the revision when %s changes", (_label, mutate) => {
    const original = cartFixture()
    const changed = cartFixture()
    mutate(changed)

    expect(createCheckoutProjection(changed).revision).not.toBe(
      createCheckoutProjection(original).revision
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 19.999])(
    "fails closed for invalid total %p",
    (total) => {
      expect(() => createCheckoutProjection(cartFixture({ total }))).toThrow(
        CheckoutProjectionError
      )
    }
  )

  it.each([null, undefined, ""])(
    "fails closed when a required total is unavailable: %p",
    (total) => {
      const cart = cartFixture()
      ;(cart as unknown as Record<string, unknown>).total = total

      expect(() => createCheckoutProjection(cart)).toThrow(
        CheckoutProjectionError
      )
    }
  )
})
