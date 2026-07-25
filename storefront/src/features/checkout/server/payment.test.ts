import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  CheckoutPaymentError,
  assertCompletablePayment,
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
          data: {
            amount: 2499,
            client_secret: "pi_test_secret_test",
            currency: "usd",
          },
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

  it("uses the official provider's cent rounding for taxable totals", () => {
    const cart = cartFixture({ total: 23.8975 })
    cart.payment_collection!.amount = 23.8975
    cart.payment_collection!.payment_sessions![0]!.amount = 23.8975
    cart.payment_collection!.payment_sessions![0]!.data = {
      amount: 2390,
      client_secret: "pi_test_secret_test",
      currency: "usd",
    }

    expect(reusablePreparedPayment(cart)).toEqual({
      clientSecret: "pi_test_secret_test",
      status: "pending",
    })
  })

  it("allows a missing collection to be initialized", () => {
    const cart = cartFixture()
    delete cart.payment_collection

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it.each([
    [
      "collection amount",
      (cart: HttpTypes.StoreCart) => {
        cart.payment_collection!.amount = 25
      },
    ],
    [
      "session amount",
      (cart: HttpTypes.StoreCart) => {
        cart.payment_collection!.payment_sessions![0]!.amount = 25
      },
    ],
    [
      "session currency",
      (cart: HttpTypes.StoreCart) => {
        cart.payment_collection!.payment_sessions![0]!.currency_code = "eur"
      },
    ],
    [
      "PaymentIntent amount",
      (cart: HttpTypes.StoreCart) => {
        cart.payment_collection!.payment_sessions![0]!.data.amount = 2500
      },
    ],
    [
      "PaymentIntent currency",
      (cart: HttpTypes.StoreCart) => {
        cart.payment_collection!.payment_sessions![0]!.data.currency = "eur"
      },
    ],
  ] as const)("rejects a stale %s", (_label, mutate) => {
    const cart = cartFixture()
    mutate(cart)

    expectCode(() => reusablePreparedPayment(cart), "payment_session_stale")
  })

  it("rejects a session without a client secret", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.data = {
      amount: 2499,
      currency: "usd",
    }

    expectCode(() => reusablePreparedPayment(cart), "payment_not_configured")
  })

  it.each([0.001, 0.49, 1_000_000])(
    "rejects a positive total outside Stripe's USD range: %p",
    (total) => {
      const cart = cartFixture({ total })
      cart.payment_collection!.amount = total
      cart.payment_collection!.payment_sessions![0]!.amount = total

      expectCode(() => reusablePreparedPayment(cart), "payment_session_stale")
    }
  )

  it("does not silently replace an authorized or captured payment", () => {
    for (const status of ["authorized", "captured"] as const) {
      const cart = cartFixture()
      cart.payment_collection!.payment_sessions![0]!.status = status

      expect(paymentNeedsFinalization(cart)).toBe(true)
      expectCode(() => assertPreparedPayment(cart), "payment_result_unknown")
    }
  })

  it.each([
    "pending",
    "requires_more",
    "authorized",
    "captured",
    "pending_authorization",
  ] as const)("accepts one exact %s session for cart completion", (status) => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.status = status

    expect(assertCompletablePayment(cart)).toEqual({ status })
  })

  it("rejects completion with more than one processable Stripe session", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions!.push({
      ...cart.payment_collection!.payment_sessions![0]!,
      id: "payses_duplicate",
    })

    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })

  it("rejects a non-Stripe session for completion", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.provider_id = "pp_other"

    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })

  it("rejects multiple reusable sessions", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions!.push({
      ...cart.payment_collection!.payment_sessions![0]!,
      id: "payses_duplicate",
    })

    expectCode(() => reusablePreparedPayment(cart), "payment_session_stale")
  })
})
