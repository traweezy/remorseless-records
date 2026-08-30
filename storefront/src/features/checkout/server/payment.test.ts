import type { HttpTypes } from "@medusajs/types"
import { describe, expect, it } from "vitest"

import {
  CheckoutPaymentError,
  assertCompletablePayment,
  assertPreparedPayment,
  paymentNeedsFinalization,
  reusablePreparedPayment,
} from "@/features/checkout/server/payment"

const taxFingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

const cartFixture = (
  overrides: Partial<HttpTypes.StoreCart> = {}
): HttpTypes.StoreCart =>
  ({
    id: "cart_test",
    currency_code: "usd",
    total: 24.99,
    items: [
      {
        id: "cali_test",
        tax_lines: [
          {
            id: "calitax_test",
            code: "rr_tax:taxrate_io:g1:quote",
            data: {
              fingerprint: taxFingerprint,
              generation: 1,
              provider: "taxrate_io",
            },
            rate: 8,
          },
        ],
      },
    ],
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
            metadata: {
              rr_tax_fingerprint: taxFingerprint,
              rr_tax_generation: "1",
              rr_tax_provider: "taxrate_io",
              rr_tax_rate_percent: "8",
            },
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

  it("reuses and completes an explicit disabled-tax payment", () => {
    const cart = cartFixture()
    const disabledLine = {
      code: "rr_tax:disabled:g4:decision",
      data: {
        collection_mode: "disabled",
        fingerprint: taxFingerprint,
        generation: 4,
      },
      rate: 0,
    }
    ;(cart.items![0] as unknown as Record<string, unknown>).tax_lines = [
      disabledLine,
    ]
    cart.payment_collection!.payment_sessions![0]!.data.metadata = {
      rr_tax_collection_mode: "disabled",
      rr_tax_fingerprint: taxFingerprint,
      rr_tax_generation: "4",
    }

    expect(reusablePreparedPayment(cart)).toEqual({
      clientSecret: "pi_test_secret_test",
      status: "pending",
    })
    expect(assertCompletablePayment(cart)).toEqual({ status: "pending" })
  })

  it.each([
    ["missing mode", undefined],
    ["collect mode", "collect"],
    ["boolean mode", false],
  ])("rejects disabled-tax payment metadata with %s", (_label, mode) => {
    const cart = cartFixture()
    ;(cart.items![0] as unknown as Record<string, unknown>).tax_lines = [
      {
        code: "rr_tax:disabled:g4:decision",
        data: {
          collection_mode: "disabled",
          fingerprint: taxFingerprint,
          generation: 4,
        },
        rate: 0,
      },
    ]
    cart.payment_collection!.payment_sessions![0]!.data.metadata = {
      ...(mode === undefined ? {} : { rr_tax_collection_mode: mode }),
      rr_tax_fingerprint: taxFingerprint,
      rr_tax_generation: "4",
    }

    expect(reusablePreparedPayment(cart)).toBeNull()
    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })

  it("rejects provider and rate metadata on a disabled-tax payment", () => {
    const cart = cartFixture()
    ;(cart.items![0] as unknown as Record<string, unknown>).tax_lines = [
      {
        code: "rr_tax:disabled:g4:decision",
        data: {
          collection_mode: "disabled",
          fingerprint: taxFingerprint,
          generation: 4,
        },
        rate: 0,
      },
    ]
    cart.payment_collection!.payment_sessions![0]!.data.metadata = {
      rr_tax_collection_mode: "disabled",
      rr_tax_fingerprint: taxFingerprint,
      rr_tax_generation: "4",
      rr_tax_provider: "taxrate_io",
      rr_tax_rate_percent: "0",
    }

    expect(reusablePreparedPayment(cart)).toBeNull()
    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })

  it("uses the official provider's cent rounding for taxable totals", () => {
    const cart = cartFixture({ total: 23.8975 })
    cart.payment_collection!.amount = 23.8975
    cart.payment_collection!.payment_sessions![0]!.amount = 23.8975
    cart.payment_collection!.payment_sessions![0]!.data = {
      ...cart.payment_collection!.payment_sessions![0]!.data,
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
  ] as const)("replaces a stale %s", (_label, mutate) => {
    const cart = cartFixture()
    mutate(cart)

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it("rejects a stale payment collection amount", () => {
    const cart = cartFixture()
    cart.payment_collection!.amount = 25

    expectCode(() => reusablePreparedPayment(cart), "payment_session_stale")
  })

  it("replaces a session without a client secret", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.data = {
      amount: 2499,
      currency: "usd",
    }

    expect(reusablePreparedPayment(cart)).toBeNull()
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

  it("does not silently replace a finalizing payment", () => {
    for (const status of [
      "authorized",
      "captured",
      "pending_authorization",
    ] as const) {
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

  it("replaces multiple reusable sessions through Medusa's single-session workflow", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions!.push({
      ...cart.payment_collection!.payment_sessions![0]!,
      id: "payses_duplicate",
    })

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it("replaces a session when the provider generation changes at the same total", () => {
    const cart = cartFixture()
    cart.items![0]!.tax_lines![0]!.code = "rr_tax:taxrate_io:g2:quote"
    ;(
      cart.items![0]!.tax_lines![0]! as unknown as Record<string, unknown>
    ).data = {
      fingerprint: "newTaxFingerprint_abcdefghijklmnopqrstuvwxyz0123456789",
      generation: 2,
      provider: "taxrate_io",
    }

    expect(reusablePreparedPayment(cart)).toBeNull()
  })

  it("rejects completion when the tax quote metadata is stale", () => {
    const cart = cartFixture()
    cart.payment_collection!.payment_sessions![0]!.data.metadata = {
      rr_tax_fingerprint: "staleTaxFingerprint_abcdefghijklmnopqrstuvwxyz01234",
      rr_tax_generation: "1",
      rr_tax_provider: "taxrate_io",
      rr_tax_rate_percent: "8",
    }

    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })

  it.each([
    [
      "boolean cart total",
      (cart: HttpTypes.StoreCart) => {
        ;(cart as unknown as Record<string, unknown>).total = true
      },
    ],
    [
      "primitive payment-session row",
      (cart: HttpTypes.StoreCart) => {
        ;(
          cart.payment_collection as unknown as Record<string, unknown>
        ).payment_sessions = [
          cart.payment_collection!.payment_sessions![0],
          false,
        ]
      },
    ],
    [
      "boolean PaymentIntent amount",
      (cart: HttpTypes.StoreCart) => {
        ;(
          cart.payment_collection!.payment_sessions![0]!.data as Record<
            string,
            unknown
          >
        ).amount = true
      },
    ],
    [
      "boolean tax generation",
      (cart: HttpTypes.StoreCart) => {
        ;(
          cart.payment_collection!.payment_sessions![0]!.data
            .metadata as Record<string, unknown>
        ).rr_tax_generation = true
      },
    ],
    [
      "boolean tax rate",
      (cart: HttpTypes.StoreCart) => {
        ;(
          cart.payment_collection!.payment_sessions![0]!.data
            .metadata as Record<string, unknown>
        ).rr_tax_rate_percent = false
      },
    ],
  ] as const)("rejects a %s", (_label, mutate) => {
    const cart = cartFixture()
    mutate(cart)

    expectCode(() => assertCompletablePayment(cart), "payment_session_stale")
  })
})
