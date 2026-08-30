import type Stripe from "stripe";

import type TaxControlModuleService from "../../modules/tax-control/service";
import { bindCheckoutTaxToPayment } from "./payment-binding";

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789";

const cartFixture = ({
  collectionMode = "collect",
  provider = "stripe_tax",
}: {
  collectionMode?: "collect" | "disabled";
  provider?: "stripe_tax" | "taxrate_io";
} = {}) => {
  const calculationId =
    collectionMode === "collect" && provider === "stripe_tax"
      ? "taxcalc_test"
      : null;
  const code =
    collectionMode === "disabled"
      ? "rr_tax:disabled:g2:decision"
      : `rr_tax:${provider}:g2:${calculationId ?? "quote"}`;
  const taxData = {
    ...(calculationId ? { calculation_id: calculationId } : {}),
    collection_mode: collectionMode,
    fingerprint,
    generation: 2,
    ...(collectionMode === "collect" ? { provider } : {}),
  };
  const metadata = {
    medusa_cart_id: "cart_01TEST",
    ...(calculationId ? { rr_tax_calculation_id: calculationId } : {}),
    rr_tax_collection_mode: collectionMode,
    rr_tax_fingerprint: fingerprint,
    rr_tax_generation: "2",
    ...(collectionMode === "collect" ? { rr_tax_provider: provider } : {}),
    ...(collectionMode === "collect" && provider === "taxrate_io"
      ? { rr_tax_rate_percent: "8" }
      : {}),
  };

  return {
    id: "cart_01TEST",
    currency_code: "usd",
    email: "buyer@example.test",
    total: 10.8,
    raw_total: { value: "10.8", precision: 20 },
    items: [
      {
        id: "cali_test",
        quantity: 1,
        tax_lines: [
          { code, data: taxData, rate: collectionMode === "disabled" ? 0 : 8 },
        ],
      },
    ],
    shipping_address: {
      first_name: "Test",
      last_name: "Buyer",
      address_1: "1 Test Street",
      city: "Buffalo",
      postal_code: "14201",
      country_code: "us",
    },
    shipping_methods: [
      {
        id: "casm_test",
        tax_lines: [
          { code, data: taxData, rate: collectionMode === "disabled" ? 0 : 8 },
        ],
      },
    ],
    payment_collection: {
      amount: 10.8,
      raw_amount: { value: "10.8", precision: 20 },
      currency_code: "usd",
      payment_sessions: [
        {
          id: "payses_test",
          amount: 10.8,
          raw_amount: { value: "10.8", precision: 20 },
          currency_code: "usd",
          provider_id: "pp_stripe_stripe",
          status: "pending",
          data: {
            amount: 1080,
            currency: "usd",
            id: "pi_test",
            metadata,
          },
        },
      ],
    },
  };
};

const intentFixture = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent =>
  ({
    amount: 1080,
    currency: "usd",
    hooks: null,
    id: "pi_test",
    livemode: false,
    metadata:
      cartFixture().payment_collection.payment_sessions[0]!.data.metadata,
    object: "payment_intent",
    status: "requires_payment_method",
    ...overrides,
  }) as Stripe.PaymentIntent;

const calculationFixture = (
  overrides: Partial<Stripe.Tax.Calculation> = {},
): Stripe.Tax.Calculation =>
  ({
    amount_total: 1080,
    currency: "usd",
    expires_at: Math.floor(Date.now() / 1000) + 3_600,
    id: "taxcalc_test",
    livemode: false,
    object: "tax.calculation",
    ...overrides,
  }) as Stripe.Tax.Calculation;

const serviceFixture = ({
  evidence = [],
}: {
  evidence?: Array<Record<string, unknown>>;
} = {}) => {
  const service = {
    listTaxQuoteEvidences: jest.fn(async (filters: Record<string, unknown>) =>
      evidence.filter((item) =>
        Object.entries(filters).every(([key, value]) => item[key] === value),
      ),
    ),
    recordTaxQuoteEvidence: jest.fn(async () => ({
      evidence: { id: "taxevidence_test" },
      replayed: false,
    })),
  };
  return service as unknown as TaxControlModuleService;
};

const stripeFixture = ({
  calculation = calculationFixture(),
  intent = intentFixture(),
}: {
  calculation?: Stripe.Tax.Calculation;
  intent?: Stripe.PaymentIntent;
} = {}) => {
  const client = {
    paymentIntents: {
      retrieve: jest.fn(async () => intent),
      update: jest.fn(async () => ({
        ...intent,
        hooks: {
          inputs: { tax: { calculation: "taxcalc_test" } },
        },
      })),
    },
    tax: {
      calculations: {
        retrieve: jest.fn(async () => calculation),
      },
    },
  };
  return client as unknown as Stripe;
};

describe("bindCheckoutTaxToPayment", () => {
  it("links one exact Stripe calculation and persists evidence", async () => {
    const client = stripeFixture();
    const service = serviceFixture();

    await expect(
      bindCheckoutTaxToPayment({
        cart: cartFixture(),
        client,
        service,
      }),
    ).resolves.toEqual({
      collectionMode: "collect",
      generation: 2,
      provider: "stripe_tax",
      replayed: false,
    });

    expect(client.paymentIntents.update).toHaveBeenCalledWith(
      "pi_test",
      expect.objectContaining({
        hooks: {
          inputs: { tax: { calculation: "taxcalc_test" } },
        },
      }),
      expect.objectContaining({
        idempotencyKey: `rr-tax-link-pi_test-${fingerprint}`,
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(service.recordTaxQuoteEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 1080,
        calculationId: "taxcalc_test",
        collectionMode: "collect",
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      }),
    );
  });

  it("re-verifies an already linked PaymentIntent without updating it", async () => {
    const client = stripeFixture({
      intent: intentFixture({
        hooks: {
          inputs: { tax: { calculation: "taxcalc_test" } },
        },
      }),
    });
    const service = serviceFixture({
      evidence: [
        {
          calculation_id: "taxcalc_test",
          payment_intent_id: "pi_test",
        },
      ],
    });

    await expect(
      bindCheckoutTaxToPayment({
        cart: cartFixture(),
        client,
        service,
      }),
    ).resolves.toMatchObject({ replayed: true });
    expect(client.paymentIntents.update).not.toHaveBeenCalled();
  });

  it("rejects a calculation amount mismatch before linking", async () => {
    const client = stripeFixture({
      calculation: calculationFixture({ amount_total: 1081 }),
    });
    const service = serviceFixture();

    await expect(
      bindCheckoutTaxToPayment({
        cart: cartFixture(),
        client,
        service,
      }),
    ).rejects.toThrow("does not match the payable Medusa cart");
    expect(client.paymentIntents.update).not.toHaveBeenCalled();
    expect(service.recordTaxQuoteEvidence).not.toHaveBeenCalled();
  });

  it("rejects late first-time linking after confirmation starts", async () => {
    const client = stripeFixture({
      intent: intentFixture({ status: "processing" }),
    });

    await expect(
      bindCheckoutTaxToPayment({
        cart: cartFixture(),
        client,
        service: serviceFixture(),
      }),
    ).rejects.toThrow("can no longer be linked safely");
    expect(client.paymentIntents.update).not.toHaveBeenCalled();
  });

  it("rejects a calculation already reserved by another PaymentIntent", async () => {
    const client = stripeFixture();
    const service = serviceFixture({
      evidence: [
        {
          calculation_id: "taxcalc_test",
          payment_intent_id: "pi_another",
        },
      ],
    });

    await expect(
      bindCheckoutTaxToPayment({
        cart: cartFixture(),
        client,
        service,
      }),
    ).rejects.toThrow("already bound to another PaymentIntent");
    expect(client.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("records TaxRate.io evidence without attaching Stripe Tax", async () => {
    const cart = cartFixture({ provider: "taxrate_io" });
    const intent = intentFixture({
      metadata: cart.payment_collection.payment_sessions[0]!.data.metadata,
    });
    const client = stripeFixture({ intent });
    const service = serviceFixture();

    await expect(
      bindCheckoutTaxToPayment({ cart, client, service }),
    ).resolves.toMatchObject({ provider: "taxrate_io" });
    expect(client.tax.calculations.retrieve).not.toHaveBeenCalled();
    expect(client.paymentIntents.update).not.toHaveBeenCalled();
    expect(service.recordTaxQuoteEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ calculationId: null }),
    );
  });

  it("records explicit disabled evidence without a provider or tax hook", async () => {
    const cart = cartFixture({ collectionMode: "disabled" });
    const intent = intentFixture({
      metadata: cart.payment_collection.payment_sessions[0]!.data.metadata,
    });
    const client = stripeFixture({ intent });
    const service = serviceFixture();

    await expect(
      bindCheckoutTaxToPayment({ cart, client, service }),
    ).resolves.toMatchObject({
      collectionMode: "disabled",
      provider: null,
    });
    expect(client.tax.calculations.retrieve).not.toHaveBeenCalled();
    expect(client.paymentIntents.update).not.toHaveBeenCalled();
    expect(service.recordTaxQuoteEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        calculationId: null,
        collectionMode: "disabled",
        provider: null,
      }),
    );
  });
});
