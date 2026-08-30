import type Stripe from "stripe";

import {
  StripePaymentBindingClientError,
  type StripePaymentBindingClient,
  verifyAndLinkStripePayment,
} from "./stripe-payment-binding-client";

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789";
const nowSeconds = Math.floor(Date.now() / 1_000);

const stripeMetadata = {
  medusa_cart_id: "cart_01TEST",
  rr_tax_calculation_id: "taxcalc_test",
  rr_tax_fingerprint: fingerprint,
  rr_tax_generation: "2",
  rr_tax_provider: "stripe_tax",
};

const intentFixture = (
  overrides: Record<string, unknown> = {},
): Stripe.PaymentIntent =>
  ({
    amount: 1_080,
    currency: "usd",
    hooks: null,
    id: "pi_test",
    livemode: false,
    metadata: stripeMetadata,
    object: "payment_intent",
    status: "requires_payment_method",
    ...overrides,
  }) as unknown as Stripe.PaymentIntent;

const calculationFixture = (
  overrides: Record<string, unknown> = {},
): Stripe.Tax.Calculation =>
  ({
    amount_total: 1_080,
    currency: "usd",
    expires_at: nowSeconds + 3_600,
    id: "taxcalc_test",
    livemode: false,
    object: "tax.calculation",
    ...overrides,
  }) as unknown as Stripe.Tax.Calculation;

const linkedIntent = intentFixture({
  hooks: { inputs: { tax: { calculation: "taxcalc_test" } } },
});

const clientWith = ({
  retrieveCalculation = jest.fn().mockResolvedValue(calculationFixture()),
  retrieveIntent = jest.fn().mockResolvedValue(intentFixture()),
  updateIntent = jest.fn().mockResolvedValue(linkedIntent),
}: {
  retrieveCalculation?: jest.Mock;
  retrieveIntent?: jest.Mock;
  updateIntent?: jest.Mock;
} = {}) => {
  const client = {
    paymentIntents: {
      retrieve: retrieveIntent,
      update: updateIntent,
    },
    tax: { calculations: { retrieve: retrieveCalculation } },
  } as unknown as StripePaymentBindingClient;
  return { client, retrieveCalculation, retrieveIntent, updateIntent };
};

type VerifyInput = Parameters<typeof verifyAndLinkStripePayment>[0];

const verify = (
  client: StripePaymentBindingClient,
  overrides: Partial<Omit<VerifyInput, "client">> = {},
) =>
  verifyAndLinkStripePayment({
    amountMinor: 1_080,
    calculationId: "taxcalc_test",
    cartId: "cart_01TEST",
    client,
    currencyCode: "usd",
    fingerprint,
    generation: 2,
    paymentIntentId: "pi_test",
    provider: "stripe_tax",
    taxRatePercent: null,
    timeoutMs: 8_000,
    ...overrides,
  });

describe("Stripe payment binding client", () => {
  it("validates both reads and links with bounded idempotent options", async () => {
    const fixture = clientWith();

    await expect(verify(fixture.client)).resolves.toEqual({
      linkedNow: true,
      livemode: false,
      previouslyLinked: false,
      status: "requires_payment_method",
    });
    expect(fixture.retrieveIntent).toHaveBeenCalledWith(
      "pi_test",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(fixture.retrieveCalculation).toHaveBeenCalledWith(
      "taxcalc_test",
      {},
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(fixture.updateIntent).toHaveBeenCalledWith(
      "pi_test",
      expect.objectContaining({
        hooks: { inputs: { tax: { calculation: "taxcalc_test" } } },
      }),
      expect.objectContaining({
        idempotencyKey: `rr-tax-link-pi_test-${fingerprint}`,
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
  });

  it("re-verifies an existing hook without issuing an update", async () => {
    const fixture = clientWith({
      retrieveIntent: jest.fn().mockResolvedValue(linkedIntent),
    });

    await expect(verify(fixture.client)).resolves.toMatchObject({
      linkedNow: false,
      previouslyLinked: true,
    });
    expect(fixture.updateIntent).not.toHaveBeenCalled();
  });

  it("accepts an omitted optional hooks input before linking", async () => {
    const fixture = clientWith({
      retrieveIntent: jest.fn().mockResolvedValue(intentFixture({ hooks: {} })),
    });

    await expect(verify(fixture.client)).resolves.toMatchObject({
      linkedNow: true,
    });
  });

  it("settles both concurrent reads before surfacing a failure", async () => {
    let releaseCalculation: (value: Stripe.Tax.Calculation) => void = () => {};
    const calculation = new Promise<Stripe.Tax.Calculation>((resolve) => {
      releaseCalculation = resolve;
    });
    const fixture = clientWith({
      retrieveCalculation: jest.fn(() => calculation),
      retrieveIntent: jest.fn().mockRejectedValue({ statusCode: 400 }),
    });
    const result = verify(fixture.client);
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCalculation(calculationFixture());
    await expect(result).rejects.toMatchObject({ code: "provider_rejected" });
  });

  it("gives concurrent reads one decreasing deadline", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValue(1_200)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100)
      .mockReturnValueOnce(1_200);
    const fixture = clientWith({
      retrieveCalculation: jest
        .fn()
        .mockResolvedValue(calculationFixture({ expires_at: 10_000 })),
    });

    try {
      await verify(fixture.client);
    } finally {
      now.mockRestore();
    }

    expect(fixture.retrieveIntent.mock.calls[0]?.[2]).toMatchObject({
      timeout: 7_900,
    });
    expect(fixture.retrieveCalculation.mock.calls[0]?.[2]).toMatchObject({
      timeout: 7_800,
    });
  });

  it.each([
    [
      "retrieve_intent",
      "transport",
      {
        retrieveIntent: jest
          .fn()
          .mockRejectedValueOnce({ type: "StripeConnectionError" })
          .mockResolvedValueOnce(intentFixture()),
      },
    ],
    [
      "retrieve_calculation",
      "status",
      {
        retrieveCalculation: jest
          .fn()
          .mockRejectedValueOnce({ statusCode: 503 })
          .mockResolvedValueOnce(calculationFixture()),
      },
    ],
    [
      "update_intent",
      "status",
      {
        updateIntent: jest
          .fn()
          .mockRejectedValueOnce({ statusCode: 503 })
          .mockResolvedValueOnce(linkedIntent),
      },
    ],
  ] as const)(
    "retries one transient %s failure with sanitized %s telemetry",
    async (operation, reason, overrides) => {
      const onRetry = jest.fn();
      const fixture = clientWith(overrides);

      await expect(verify(fixture.client, { onRetry })).resolves.toMatchObject({
        linkedNow: true,
      });
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 2,
        operation,
        reason,
        totalAttempts: 2,
      });
      if (operation === "update_intent") {
        expect(fixture.updateIntent).toHaveBeenCalledTimes(2);
        expect(fixture.updateIntent.mock.calls[0]?.[2]).toMatchObject({
          idempotencyKey: `rr-tax-link-pi_test-${fingerprint}`,
        });
        expect(fixture.updateIntent.mock.calls[1]?.[2]).toMatchObject({
          idempotencyKey: `rr-tax-link-pi_test-${fingerprint}`,
        });
      }
    },
  );

  it("keeps rate limits single-attempt even when Stripe requests retry", async () => {
    const onRetry = jest.fn();
    const retrieveIntent = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "true" },
      statusCode: 429,
    });
    const fixture = clientWith({ retrieveIntent });

    await expect(verify(fixture.client, { onRetry })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(retrieveIntent).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("honors Stripe's explicit retry opt-out", async () => {
    const onRetry = jest.fn();
    const retrieveIntent = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "false" },
      statusCode: 503,
    });
    const fixture = clientWith({ retrieveIntent });

    await expect(verify(fixture.client, { onRetry })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(retrieveIntent).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("stops before a retry that cannot fit in the shared deadline", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValue(1_100)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100);
    const retrieveIntent = jest
      .fn()
      .mockRejectedValue({ type: "StripeConnectionError" });
    const fixture = clientWith({ retrieveIntent });

    try {
      await expect(
        verify(fixture.client, { timeoutMs: 150 }),
      ).rejects.toMatchObject({ code: "deadline_exceeded" });
    } finally {
      now.mockRestore();
    }
    expect(retrieveIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ timeoutMs: 0 }, "invalid timeout"],
    [{ timeoutMs: 30_001 }, "oversized timeout"],
    [{ amountMinor: 0 }, "invalid amount"],
    [{ fingerprint: "too-short" }, "invalid fingerprint"],
    [{ calculationId: "unsafe/id" }, "invalid calculation ID"],
  ] as const)(
    "rejects %s before contacting Stripe (%s)",
    async (overrides, _description) => {
      const fixture = clientWith();

      await expect(verify(fixture.client, overrides)).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(fixture.retrieveIntent).not.toHaveBeenCalled();
      expect(fixture.retrieveCalculation).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ object: "account" }, "invalid_response"],
    [{ id: "pi_different" }, "invalid_response"],
    [{ amount: 1_080.5 }, "invalid_response"],
    [{ currency: null }, "invalid_response"],
    [{ status: "unknown" }, "invalid_response"],
    [{ metadata: null }, "invalid_response"],
    [{ hooks: { inputs: "invalid" } }, "invalid_response"],
    [{ amount: 1_081 }, "payment_mismatch"],
    [{ currency: "cad" }, "payment_mismatch"],
  ] as const)(
    "rejects malformed or mismatched PaymentIntents",
    async (overrides, code) => {
      const fixture = clientWith({
        retrieveIntent: jest.fn().mockResolvedValue(intentFixture(overrides)),
      });

      await expect(verify(fixture.client)).rejects.toMatchObject({ code });
      expect(fixture.updateIntent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { medusa_cart_id: "cart_other" },
    { rr_tax_calculation_id: "taxcalc_other" },
    { rr_tax_fingerprint: `${fingerprint}other` },
    { rr_tax_generation: "3" },
    { rr_tax_provider: "taxrate_io" },
    { rr_tax_rate_percent: "8" },
  ])("rejects a changed PaymentIntent tax identity", async (changed) => {
    const fixture = clientWith({
      retrieveIntent: jest
        .fn()
        .mockResolvedValue(
          intentFixture({ metadata: { ...stripeMetadata, ...changed } }),
        ),
    });

    await expect(verify(fixture.client)).rejects.toMatchObject({
      code: "tax_identity_mismatch",
    });
  });

  it.each([
    [{ object: "tax.registration" }, "invalid_response"],
    [{ id: "taxcalc_other" }, "invalid_response"],
    [{ amount_total: 1_080.5 }, "invalid_response"],
    [{ expires_at: "later" }, "invalid_response"],
    [{ amount_total: 1_081 }, "calculation_mismatch"],
    [{ currency: "cad" }, "calculation_mismatch"],
    [{ livemode: true }, "calculation_mismatch"],
    [{ expires_at: null }, "calculation_mismatch"],
    [{ expires_at: nowSeconds - 1 }, "calculation_mismatch"],
  ] as const)(
    "rejects malformed or mismatched calculations",
    async (overrides, code) => {
      const fixture = clientWith({
        retrieveCalculation: jest
          .fn()
          .mockResolvedValue(calculationFixture(overrides)),
      });

      await expect(verify(fixture.client)).rejects.toMatchObject({ code });
      expect(fixture.updateIntent).not.toHaveBeenCalled();
    },
  );

  it("rejects a conflicting existing hook", async () => {
    const fixture = clientWith({
      retrieveIntent: jest.fn().mockResolvedValue(
        intentFixture({
          hooks: { inputs: { tax: { calculation: "taxcalc_other" } } },
        }),
      ),
    });

    await expect(verify(fixture.client)).rejects.toMatchObject({
      code: "hook_conflict",
    });
    expect(fixture.updateIntent).not.toHaveBeenCalled();
  });

  it("rejects first-time linking after payment confirmation begins", async () => {
    const fixture = clientWith({
      retrieveIntent: jest
        .fn()
        .mockResolvedValue(intentFixture({ status: "processing" })),
    });

    await expect(verify(fixture.client)).rejects.toMatchObject({
      code: "not_linkable",
    });
    expect(fixture.updateIntent).not.toHaveBeenCalled();
  });

  it.each([
    [intentFixture(), "missing hook acknowledgement"],
    [intentFixture({ ...linkedIntent, livemode: true }), "changed mode"],
  ])("rejects an invalid update acknowledgement (%s)", async (updatedValue) => {
    const fixture = clientWith({
      updateIntent: jest.fn().mockResolvedValue(updatedValue),
    });

    await expect(verify(fixture.client)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each(["", " 8", "8 ", "+8", "08", "1e1", "NaN", "101"])(
    "rejects non-canonical TaxRate.io metadata (%s)",
    async (rate) => {
      const fixture = clientWith({
        retrieveIntent: jest.fn().mockResolvedValue(
          intentFixture({
            metadata: {
              medusa_cart_id: "cart_01TEST",
              rr_tax_fingerprint: fingerprint,
              rr_tax_generation: "2",
              rr_tax_provider: "taxrate_io",
              rr_tax_rate_percent: rate,
            },
          }),
        ),
      });

      await expect(
        verify(fixture.client, {
          calculationId: null,
          provider: "taxrate_io",
          taxRatePercent: 8,
        }),
      ).rejects.toMatchObject({ code: "tax_identity_mismatch" });
      expect(fixture.retrieveCalculation).not.toHaveBeenCalled();
      expect(fixture.updateIntent).not.toHaveBeenCalled();
    },
  );

  it("accepts canonical TaxRate.io metadata without a Stripe Tax update", async () => {
    const fixture = clientWith({
      retrieveIntent: jest.fn().mockResolvedValue(
        intentFixture({
          metadata: {
            medusa_cart_id: "cart_01TEST",
            rr_tax_fingerprint: fingerprint,
            rr_tax_generation: "2",
            rr_tax_provider: "taxrate_io",
            rr_tax_rate_percent: "8.0",
          },
        }),
      ),
    });

    await expect(
      verify(fixture.client, {
        calculationId: null,
        provider: "taxrate_io",
        taxRatePercent: 8,
      }),
    ).resolves.toMatchObject({ linkedNow: false, previouslyLinked: false });
    expect(fixture.retrieveCalculation).not.toHaveBeenCalled();
    expect(fixture.updateIntent).not.toHaveBeenCalled();
  });

  it("redacts Stripe response details from typed errors", async () => {
    const secret = "sk_test_private_provider_message";
    const fixture = clientWith({
      retrieveIntent: jest.fn().mockRejectedValue({
        message: secret,
        statusCode: 400,
      }),
    });

    try {
      await verify(fixture.client);
      throw new Error("Expected the payment binding to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(StripePaymentBindingClientError);
      expect(String(error)).not.toContain(secret);
      expect(error).toMatchObject({ code: "provider_rejected" });
    }
  });
});
