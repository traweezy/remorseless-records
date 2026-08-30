import {
  CheckoutPaymentValidationError,
  validateCheckoutPayment,
} from "./payment-validation"

const taxFingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"

const validCart = () => ({
  id: "cart_test",
  currency_code: "usd",
  email: "buyer@example.test",
  total: 24.99,
  raw_total: { value: "24.99", precision: 20 },
  items: [
    {
      id: "cali_test",
      quantity: 1,
      tax_lines: [
        {
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
      id: "casm_test",
      shipping_option_id: "so_test",
      tax_lines: [
        {
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
    amount: 24.99,
    raw_amount: { value: "24.99", precision: 20 },
    currency_code: "USD",
    payment_sessions: [
      {
        id: "payses_test",
        amount: 24.99,
        raw_amount: { value: "24.99", precision: 20 },
        currency_code: "usd",
        provider_id: "pp_stripe_stripe",
        status: "pending",
        data: {
          amount: 2499,
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
})

const expectCode = (
  cart: unknown,
  code: CheckoutPaymentValidationError["code"]
): void => {
  try {
    validateCheckoutPayment(cart)
    throw new Error("Expected checkout validation to fail")
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CheckoutPaymentValidationError)
    expect((error as CheckoutPaymentValidationError).code).toBe(code)
  }
}

describe("checkout payment validation", () => {
  it("accepts one exact Stripe session for the locked cart snapshot", () => {
    expect(validateCheckoutPayment(validCart())).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: "pending",
      total: "24.99",
    })
  })

  it("accepts an explicit disabled-tax quote with bounded payment metadata", () => {
    const base = validCart()
    const disabledLine = {
      code: "rr_tax:disabled:g4:decision",
      data: {
        collection_mode: "disabled",
        fingerprint: taxFingerprint,
        generation: 4,
      },
      rate: 0,
    }
    const cart = {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        tax_lines: [disabledLine],
      })),
      payment_collection: {
        ...base.payment_collection,
        payment_sessions: base.payment_collection.payment_sessions.map(
          (session) => ({
            ...session,
            data: {
              ...session.data,
              metadata: {
                rr_tax_collection_mode: "disabled",
                rr_tax_fingerprint: taxFingerprint,
                rr_tax_generation: "4",
              },
            },
          })
        ),
      },
      shipping_methods: base.shipping_methods.map((method) => ({
        ...method,
        tax_lines: [disabledLine],
      })),
    }

    expect(validateCheckoutPayment(cart)).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: "pending",
      total: "24.99",
    })
  })

  it("accepts a zero-total cart without creating a Stripe session", () => {
    const cart = validCart()
    cart.total = 0
    cart.raw_total = { value: "0", precision: 20 }
    cart.payment_collection.payment_sessions = []

    expect(validateCheckoutPayment(cart)).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: null,
      total: "0",
    })
  })

  it("rejects malformed controlled tax data on a zero-total cart", () => {
    const cart = validCart()
    cart.total = 0
    cart.raw_total = { value: "0", precision: 20 }
    cart.payment_collection.payment_sessions = []
    cart.items[0]!.tax_lines[0]!.data.generation = false as never

    expectCode(cart, "checkout_tax_quote_invalid")
  })

  it("accepts raw tax precision when Stripe matches the rounded cents", () => {
    const cart = validCart()
    cart.total = 23.8975
    cart.raw_total = { value: "23.8975", precision: 20 }
    cart.payment_collection.amount = 23.8975
    cart.payment_collection.raw_amount = {
      value: "23.8975",
      precision: 20,
    }
    cart.payment_collection.payment_sessions[0]!.amount = 23.8975
    cart.payment_collection.payment_sessions[0]!.raw_amount = {
      value: "23.8975",
      precision: 20,
    }
    cart.payment_collection.payment_sessions[0]!.data.amount = 2390

    expect(validateCheckoutPayment(cart)).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: "pending",
      total: "23.8975",
    })
  })

  it.each([
    [
      "cart amount",
      (cart: ReturnType<typeof validCart>) => {
        cart.raw_total = { value: "25", precision: 20 }
      },
    ],
    [
      "collection amount",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.raw_amount = {
          value: "25",
          precision: 20,
        }
      },
    ],
    [
      "session amount",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.payment_sessions[0]!.raw_amount = {
          value: "25",
          precision: 20,
        }
      },
    ],
  ])("rejects a mismatched %s", (_label, mutate) => {
    const cart = validCart()
    mutate(cart)

    expectCode(cart, "checkout_payment_amount_mismatch")
  })

  it("rejects a currency mismatch", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions[0]!.currency_code = "eur"

    expectCode(cart, "checkout_payment_currency_mismatch")
  })

  it("rejects a mismatched Stripe PaymentIntent amount", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions[0]!.data.amount = 2500

    expectCode(cart, "checkout_payment_amount_mismatch")
  })

  it.each([false, [], { value: true }, "2499.0", "2.499e3"])(
    "rejects a coercive Stripe PaymentIntent amount %p",
    (amount) => {
      const cart = validCart()
      cart.payment_collection.payment_sessions[0]!.data.amount = amount as never

      expectCode(cart, "checkout_payment_amount_mismatch")
    }
  )

  it("rejects a mismatched Stripe PaymentIntent currency", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions[0]!.data.currency = "eur"

    expectCode(cart, "checkout_payment_currency_mismatch")
  })

  it("rejects a mismatched tax provider generation at the same total", () => {
    const cart = validCart()
    cart.payment_collection
      .payment_sessions[0]!.data.metadata.rr_tax_generation = "2"

    expectCode(cart, "checkout_tax_quote_invalid")
  })

  it.each([false, [], "1.0", "1e0"])(
    "rejects a coercive tax generation %p",
    (generation) => {
      const cart = validCart()
      cart.payment_collection
        .payment_sessions[0]!.data.metadata.rr_tax_generation =
        generation as never

      expectCode(cart, "checkout_tax_quote_invalid")
    }
  )

  it.each([false, [], { value: true }])(
    "rejects a coercive tax rate %p",
    (rate) => {
      const cart = validCart()
      cart.payment_collection
        .payment_sessions[0]!.data.metadata.rr_tax_rate_percent = rate as never

      expectCode(cart, "checkout_tax_quote_invalid")
    }
  )

  it("rejects the system provider for a positive checkout", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions[0]!.provider_id = "pp_system"

    expectCode(cart, "checkout_payment_session_provider_invalid")
  })

  it("rejects more than one processable payment session", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions.push({
      ...cart.payment_collection.payment_sessions[0]!,
      id: "payses_duplicate",
    })

    expectCode(cart, "checkout_payment_session_multiple")
  })

  it("ignores an obsolete failed session when one current session is valid", () => {
    const cart = validCart()
    cart.payment_collection.payment_sessions.push({
      ...cart.payment_collection.payment_sessions[0]!,
      id: "payses_failed",
      status: "error",
    })

    expect(validateCheckoutPayment(cart).paymentSessionStatus).toBe("pending")
  })

  it.each([
    [
      "primitive cart item",
      "checkout_money_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.items.push(false as never)
      },
    ],
    [
      "boolean cart-item quantity",
      "checkout_money_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.items[0]!.quantity = false as never
      },
    ],
    [
      "primitive shipping method",
      "checkout_money_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.shipping_methods.push(false as never)
      },
    ],
    [
      "object shipping-option identity",
      "checkout_money_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.shipping_methods[0]!.shipping_option_id = {
          id: "so_test",
        } as never
      },
    ],
    [
      "primitive payment session",
      "checkout_payment_session_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.payment_sessions.push(false as never)
      },
    ],
    [
      "non-string failed-session status",
      "checkout_payment_session_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.payment_sessions.push({
          ...cart.payment_collection.payment_sessions[0]!,
          id: "payses_malformed",
          status: false as never,
        })
      },
    ],
    [
      "array PaymentIntent snapshot",
      "checkout_payment_session_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.payment_sessions[0]!.data = [] as never
      },
    ],
    [
      "array PaymentIntent metadata",
      "checkout_tax_quote_invalid",
      (cart: ReturnType<typeof validCart>) => {
        cart.payment_collection.payment_sessions[0]!.data.metadata = [] as never
      },
    ],
  ] as const)("rejects a %s", (_label, code, mutate) => {
    const cart = validCart()
    mutate(cart)

    expectCode(cart, code)
  })

  it.each([
    [
      "missing contact",
      (cart: ReturnType<typeof validCart>) => {
        cart.email = ""
      },
      "checkout_contact_missing",
    ],
    [
      "missing address",
      (cart: ReturnType<typeof validCart>) => {
        cart.shipping_address.postal_code = ""
      },
      "checkout_address_missing",
    ],
    [
      "missing province",
      (cart: ReturnType<typeof validCart>) => {
        cart.shipping_address.province = ""
      },
      "checkout_address_missing",
    ],
    [
      "missing shipping",
      (cart: ReturnType<typeof validCart>) => {
        cart.shipping_methods = []
      },
      "checkout_shipping_missing",
    ],
  ] as const)("rejects %s", (_label, mutate, code) => {
    const cart = validCart()
    mutate(cart)

    expectCode(cart, code)
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    "not-money",
    false,
    [],
    { value: true },
  ])("rejects invalid money value %p", (amount) => {
    const cart = validCart()
    cart.raw_total = amount as never

    expectCode(cart, "checkout_money_invalid")
  })

  it.each(["0.001", "0.49", "1000000"])(
    "rejects a positive total outside Stripe's USD range: %s",
    (amount) => {
      const cart = validCart()
      cart.raw_total = { value: amount, precision: 20 }
      cart.payment_collection.raw_amount = {
        value: amount,
        precision: 20,
      }
      cart.payment_collection.payment_sessions[0]!.raw_amount = {
        value: amount,
        precision: 20,
      }

      expectCode(cart, "checkout_money_invalid")
    }
  )
})
