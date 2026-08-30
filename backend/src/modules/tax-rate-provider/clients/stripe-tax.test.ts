import type Stripe from "stripe";

import {
  createStripeTaxCalculation,
  retrieveStripeTaxCalculation,
  StripeTaxClientError,
} from "./stripe-tax";

const calculation = {
  amount_total: 3_200,
  currency: "usd",
  expires_at: 1_800_000_000,
  id: "taxcalc_example",
  line_items: {
    data: [
      {
        amount_tax: 185,
        object: "tax.calculation_line_item",
        reference: "item_1",
      },
    ],
    has_more: false,
    object: "list",
  },
  livemode: false,
  object: "tax.calculation",
  shipping_cost: {
    amount_tax: 15,
  },
  tax_amount_exclusive: 200,
} as unknown as Stripe.Tax.Calculation;

const clientWith = (
  overrides: Partial<Stripe["tax"]["calculations"]> = {},
): Pick<Stripe, "tax"> =>
  ({
    tax: {
      calculations: {
        create: jest.fn().mockResolvedValue(calculation),
        listLineItems: jest.fn().mockResolvedValue({
          data: calculation.line_items?.data ?? [],
          has_more: false,
          object: "list",
        }),
        retrieve: jest.fn().mockResolvedValue(calculation),
        ...overrides,
      },
    },
  }) as unknown as Pick<Stripe, "tax">;

const createCalculation = (
  client: Pick<Stripe, "tax">,
  overrides: Partial<Parameters<typeof createStripeTaxCalculation>[0]> = {},
) =>
  createStripeTaxCalculation({
    address: {
      address1: "1 Main Street",
      city: "Stamford",
      countryCode: "us",
      postalCode: "06902",
      provinceCode: "ct",
    },
    client,
    currency: "USD",
    idempotencyKey: "tax-cart-fingerprint",
    itemLines: [
      {
        amount: 2_500,
        quantity: 2,
        reference: "item_1",
        taxCode: "txcd_99999999",
      },
    ],
    shipping: {
      amount: 500,
      taxCode: "txcd_92010001",
    },
    timeoutMs: 8_000,
    ...overrides,
  });

describe("Stripe Tax calculation client", () => {
  it("creates an exclusive calculation with a bounded idempotent request", async () => {
    const client = clientWith();

    const result = await createCalculation(client);

    expect(client.tax.calculations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "usd",
        customer_details: {
          address: {
            city: "Stamford",
            country: "US",
            line1: "1 Main Street",
            postal_code: "06902",
            state: "CT",
          },
          address_source: "shipping",
        },
        line_items: [
          {
            amount: 2_500,
            quantity: 2,
            reference: "item_1",
            tax_behavior: "exclusive",
            tax_code: "txcd_99999999",
          },
        ],
      }),
      expect.objectContaining({
        idempotencyKey: "tax-cart-fingerprint",
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(result).toEqual({
      amountTotal: 3_200,
      calculationId: "taxcalc_example",
      currency: "usd",
      expiresAt: 1_800_000_000,
      itemTaxByReference: { item_1: 185 },
      livemode: false,
      shippingTax: 15,
      taxAmountExclusive: 200,
    });
  });

  it("retrieves a frozen calculation with an explicit bounded read policy", async () => {
    const client = clientWith();

    await retrieveStripeTaxCalculation({
      calculationId: "taxcalc_example",
      client,
      expectedReferences: ["item_1"],
      timeoutMs: 8_000,
    });

    expect(client.tax.calculations.retrieve).toHaveBeenCalledWith(
      "taxcalc_example",
      { expand: ["line_items"] },
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(client.tax.calculations.create).not.toHaveBeenCalled();
  });

  it("uses the remaining deadline for one bounded line-item page", async () => {
    const client = clientWith({
      retrieve: jest.fn().mockResolvedValue({
        ...calculation,
        line_items: { data: [], has_more: true, object: "list" },
      }),
    });

    await retrieveStripeTaxCalculation({
      calculationId: "taxcalc_example",
      client,
      expectedReferences: ["item_1"],
      timeoutMs: 8_000,
    });

    expect(client.tax.calculations.listLineItems).toHaveBeenCalledWith(
      "taxcalc_example",
      { limit: 100 },
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
  });

  it.each([
    [
      "transport",
      {
        raw: { detail: { code: "ECONNRESET" } },
        type: "StripeConnectionError",
      },
    ],
    ["status", { statusCode: 503, type: "StripeAPIError" }],
  ] as const)("retries one transient %s failure", async (reason, failure) => {
    const onRetry = jest.fn();
    const create = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(calculation);
    const client = clientWith({ create });

    await expect(createCalculation(client, { onRetry })).resolves.toMatchObject(
      { calculationId: "taxcalc_example" },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 2,
      operation: "create",
      reason,
      totalAttempts: 2,
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: "tax-cart-fingerprint",
      maxNetworkRetries: 0,
    });
    expect(create.mock.calls[1]?.[1]).toMatchObject({
      idempotencyKey: "tax-cart-fingerprint",
      maxNetworkRetries: 0,
    });
  });

  it("keeps Stripe rate limits single-attempt", async () => {
    const onRetry = jest.fn();
    const create = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "true" },
      message: "Do not copy this provider detail",
      statusCode: 429,
      type: "StripeRateLimitError",
    });
    const client = clientWith({ create });

    await expect(createCalculation(client, { onRetry })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("honors Stripe's explicit retry opt-out", async () => {
    const onRetry = jest.fn();
    const create = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "false" },
      statusCode: 503,
      type: "StripeAPIError",
    });
    const client = clientWith({ create });

    await expect(createCalculation(client, { onRetry })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("fails closed when line-item pagination exceeds the supported bound", async () => {
    const client = clientWith({
      listLineItems: jest.fn().mockResolvedValue({
        data: calculation.line_items?.data ?? [],
        has_more: true,
        object: "list",
      }),
      retrieve: jest.fn().mockResolvedValue({
        ...calculation,
        line_items: { data: [], has_more: true, object: "list" },
      }),
    });

    await expect(
      retrieveStripeTaxCalculation({
        calculationId: "taxcalc_example",
        client,
        expectedReferences: ["item_1"],
        timeoutMs: 8_000,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects oversized requests before contacting Stripe", async () => {
    const client = clientWith();

    await expect(
      createCalculation(client, {
        itemLines: Array.from({ length: 101 }, (_, index) => ({
          amount: 100,
          quantity: 1,
          reference: `item_${index}`,
        })),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.tax.calculations.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "duplicate references",
      [
        { amount: 100, quantity: 1, reference: "item_1" },
        { amount: 200, quantity: 1, reference: "item_1" },
      ],
    ],
    [
      "fractional amounts",
      [{ amount: 100.5, quantity: 1, reference: "item_1" }],
    ],
    [
      "invalid tax codes",
      [{ amount: 100, quantity: 1, reference: "item_1", taxCode: "unsafe" }],
    ],
  ])("rejects %s before contacting Stripe", async (_name, itemLines) => {
    const client = clientWith();

    await expect(
      createCalculation(client, { itemLines }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(client.tax.calculations.create).not.toHaveBeenCalled();
  });

  it("rejects mismatched or duplicate response line references", async () => {
    const client = clientWith({
      create: jest.fn().mockResolvedValue({
        ...calculation,
        line_items: {
          data: [
            {
              amount_tax: 100,
              object: "tax.calculation_line_item",
              reference: "unexpected",
            },
            {
              amount_tax: 85,
              object: "tax.calculation_line_item",
              reference: "unexpected",
            },
          ],
          has_more: false,
        },
      }),
    });

    await expect(createCalculation(client)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each([
    ["unsafe amount", { amount_total: Number.NaN }],
    ["inconsistent tax", { tax_amount_exclusive: 201 }],
    ["invalid mode", { livemode: "false" }],
    ["invalid object", { object: "customer" }],
  ])("rejects an %s in the provider response", async (_name, invalid) => {
    const client = clientWith({
      retrieve: jest.fn().mockResolvedValue({ ...calculation, ...invalid }),
    });

    await expect(
      retrieveStripeTaxCalculation({
        calculationId: "taxcalc_example",
        client,
        expectedReferences: ["item_1"],
        timeoutMs: 8_000,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps provider rejection to a coded error without copying details", async () => {
    const client = clientWith({
      create: jest.fn().mockRejectedValue({
        message: "Address and secret must never escape",
        raw: { message: "Provider response must never escape" },
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }),
    });

    const error = await createCalculation(client).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(StripeTaxClientError);
    expect(error).toMatchObject({ code: "provider_rejected" });
    expect(String(error)).toBe(
      "StripeTaxClientError: Stripe Tax request failed (provider_rejected).",
    );
    expect(String(error)).not.toContain("Address");
    expect(String(error)).not.toContain("secret");
  });

  it("classifies SDK timeout cancellation without copying transport details", async () => {
    const client = clientWith({
      retrieve: jest.fn().mockRejectedValue({
        message: "Sensitive transport detail",
        raw: { detail: { code: "ETIMEDOUT" } },
        type: "StripeConnectionError",
      }),
    });

    const error = await retrieveStripeTaxCalculation({
      calculationId: "taxcalc_example",
      client,
      expectedReferences: ["item_1"],
      timeoutMs: 8_000,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "deadline_exceeded" });
    expect(String(error)).not.toContain("Sensitive");
  });

  it("stops before a follow-up read when the shared deadline is exhausted", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValue(9_001);
    const client = clientWith({
      retrieve: jest.fn().mockResolvedValue({
        ...calculation,
        line_items: { data: [], has_more: true, object: "list" },
      }),
    });

    try {
      await expect(
        retrieveStripeTaxCalculation({
          calculationId: "taxcalc_example",
          client,
          expectedReferences: ["item_1"],
          timeoutMs: 8_000,
        }),
      ).rejects.toMatchObject({ code: "deadline_exceeded" });
      expect(client.tax.calculations.listLineItems).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
