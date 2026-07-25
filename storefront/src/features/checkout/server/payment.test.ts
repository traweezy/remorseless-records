import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  CheckoutPaymentError,
  assertPreparedPayment,
  paymentNeedsFinalization,
  reusablePreparedPayment,
} from "@/features/checkout/server/payment"

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_test",
    currency_code: "usd",
    total: 24.99,
    payment_collection: {
      id: "pay_col_test",
      amount: 24.99,
      currency_code: "usd",
      payment_sessions: [
        {
          id: "payses_test",
          amount: 24.99,
          currency_code: "usd",
          provider_id: "pp_stripe_stripe",
          status: "pending",
          data: { client_secret: "pi_test_secret_test" },
        },
      ],
    },
    ...overrides,
  }) as HttpTypes.StoreCart

const expectCode = (
  operation: () => unknown,
  code: CheckoutPaymentError["code"]
) => {
  try {
    operation()
    throw new Error("Expected payment validation to fail")
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CheckoutPaymentError)
    expect((error as CheckoutPaymentError).code).toBe(code)
  }
}

describe("checkout payment preparation", () => {
  it("reuses one exact pending Stripe session", () => {
    expect(reusablePreparedPayment(cartFixture())).toEqual({
      clientSecret: "pi_test_secret_test",
      status: "pending",
    })
  })

  it("does not require Stripe for a zero total", () => {
    const cart = cartFixture({ total: 0 })
    delete cart.payment_collection

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it("allows a missing collection to be initialized", () => {
    const cart = cartFixture()
    delete cart.payment_collection

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it.each([
    ["collection amount", (cart: HttpTypes.StoreCart) => {
      cart.payment_collection!.amount = 25
    }],
    ["session amount", (cart: HttpTypes.StoreCart) => {
      cart.payment_collection!.payment_sessions![0]!.amount = 25
    }],
    ["session currency", (cart: HttpTypes.StoreCart) => {
      cart.payment_collection!.payment_sessions![0]!.currency_code = "eur"
    }],
  ] as const)("rejects a stale %s", (_label, mutate) => {
    const cart = cartFixture()
    mutate(cart)

    expectCode(
      () => reusablePreparedPayment(cart),
      "payment_session_stale"
    )
  })

  it("rejects a session without a client secret", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.data = {}

    expectCode(
      () => reusablePreparedPayment(cart),
      "payment_not_configured"
    )
  })

  it("does not silently replace an authorized or captured payment", () => {
    for (const status of ["authorized", "captured"] as const) {
      const cart = cartFixture()
      cart.payment_collection!.payment_sessions![0]!.status = status

      expect(paymentNeedsFinalization(cart)).toBe(true)
      expectCode(() => assertPreparedPayment(cart), "payment_result_unknown")
    }
  })

  it("rejects multiple reusable sessions", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions!.push({
      ...cart.payment_collection!.payment_sessions![0]!,
      id: "payses_duplicate",
    })

    expectCode(
      () => reusablePreparedPayment(cart),
      "payment_session_stale"
    )
  })
})
