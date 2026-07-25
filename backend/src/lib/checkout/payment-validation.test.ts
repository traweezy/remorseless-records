import {
  CheckoutPaymentValidationError,
  validateCheckoutPayment,
} from "./payment-validation";

const validCart = () => ({
  id: "cart_test",
  currency_code: "usd",
  email: "buyer@example.test",
  total: 24.99,
  raw_total: { value: "24.99", precision: 20 },
  items: [{ id: "cali_test", quantity: 1 }],
  shipping_address: {
    first_name: "Test",
    last_name: "Buyer",
    address_1: "354 Oyster Point Boulevard",
    city: "South San Francisco",
    postal_code: "94080",
    country_code: "us",
  },
  shipping_methods: [{ id: "casm_test" }],
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
        },
      },
    ],
  },
});

const expectCode = (
  cart: unknown,
  code: CheckoutPaymentValidationError["code"],
): void => {
  try {
    validateCheckoutPayment(cart);
    throw new Error("Expected checkout validation to fail");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CheckoutPaymentValidationError);
    expect((error as CheckoutPaymentValidationError).code).toBe(code);
  }
};

describe("checkout payment validation", () => {
  it("accepts one exact Stripe session for the locked cart snapshot", () => {
    expect(validateCheckoutPayment(validCart())).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: "pending",
      total: "24.99",
    });
  });

  it("accepts a zero-total cart without creating a Stripe session", () => {
    const cart = validCart();
    cart.total = 0;
    cart.raw_total = { value: "0", precision: 20 };
    cart.payment_collection.payment_sessions = [];

    expect(validateCheckoutPayment(cart)).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: null,
      total: "0",
    });
  });

  it("accepts raw tax precision when Stripe matches the rounded cents", () => {
    const cart = validCart();
    cart.total = 23.8975;
    cart.raw_total = { value: "23.8975", precision: 20 };
    cart.payment_collection.amount = 23.8975;
    cart.payment_collection.raw_amount = {
      value: "23.8975",
      precision: 20,
    };
    cart.payment_collection.payment_sessions[0]!.amount = 23.8975;
    cart.payment_collection.payment_sessions[0]!.raw_amount = {
      value: "23.8975",
      precision: 20,
    };
    cart.payment_collection.payment_sessions[0]!.data.amount = 2390;

    expect(validateCheckoutPayment(cart)).toEqual({
      currencyCode: "usd",
      paymentSessionStatus: "pending",
      total: "23.8975",
    });
  });

  it.each([
    ["cart amount", (cart: ReturnType<typeof validCart>) => {
      cart.raw_total = { value: "25", precision: 20 };
    }],
    ["collection amount", (cart: ReturnType<typeof validCart>) => {
      cart.payment_collection.raw_amount = {
        value: "25",
        precision: 20,
      };
    }],
    ["session amount", (cart: ReturnType<typeof validCart>) => {
      cart.payment_collection.payment_sessions[0]!.raw_amount = {
        value: "25",
        precision: 20,
      };
    }],
  ])("rejects a mismatched %s", (_label, mutate) => {
    const cart = validCart();
    mutate(cart);

    expectCode(cart, "checkout_payment_amount_mismatch");
  });

  it("rejects a currency mismatch", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions[0]!.currency_code = "eur";

    expectCode(cart, "checkout_payment_currency_mismatch");
  });

  it("rejects a mismatched Stripe PaymentIntent amount", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions[0]!.data.amount = 2500;

    expectCode(cart, "checkout_payment_amount_mismatch");
  });

  it("rejects a mismatched Stripe PaymentIntent currency", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions[0]!.data.currency = "eur";

    expectCode(cart, "checkout_payment_currency_mismatch");
  });

  it("rejects the system provider for a positive checkout", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions[0]!.provider_id = "pp_system";

    expectCode(cart, "checkout_payment_session_provider_invalid");
  });

  it("rejects more than one processable payment session", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions.push({
      ...cart.payment_collection.payment_sessions[0]!,
      id: "payses_duplicate",
    });

    expectCode(cart, "checkout_payment_session_multiple");
  });

  it("ignores an obsolete failed session when one current session is valid", () => {
    const cart = validCart();
    cart.payment_collection.payment_sessions.push({
      ...cart.payment_collection.payment_sessions[0]!,
      id: "payses_failed",
      status: "error",
    });

    expect(validateCheckoutPayment(cart).paymentSessionStatus).toBe("pending");
  });

  it.each([
    ["missing contact", (cart: ReturnType<typeof validCart>) => {
      cart.email = "";
    }, "checkout_contact_missing"],
    ["missing address", (cart: ReturnType<typeof validCart>) => {
      cart.shipping_address.postal_code = "";
    }, "checkout_address_missing"],
    ["missing shipping", (cart: ReturnType<typeof validCart>) => {
      cart.shipping_methods = [];
    }, "checkout_shipping_missing"],
  ] as const)("rejects %s", (_label, mutate, code) => {
    const cart = validCart();
    mutate(cart);

    expectCode(cart, code);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    "not-money",
  ])("rejects invalid money value %p", (amount) => {
    const cart = validCart();
    cart.raw_total = amount as never;

    expectCode(cart, "checkout_money_invalid");
  });

  it.each(["0.001", "0.49", "1000000"])(
    "rejects a positive total outside Stripe's USD range: %s",
    (amount) => {
      const cart = validCart();
      cart.raw_total = { value: amount, precision: 20 };
      cart.payment_collection.raw_amount = {
        value: amount,
        precision: 20,
      };
      cart.payment_collection.payment_sessions[0]!.raw_amount = {
        value: amount,
        precision: 20,
      };

      expectCode(cart, "checkout_money_invalid");
    },
  );
});
