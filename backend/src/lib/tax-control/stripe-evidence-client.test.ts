import type Stripe from "stripe";

import {
  createStripeEvidenceReader,
  StripeEvidenceClientError,
  type StripeEvidenceClient,
} from "./stripe-evidence-client";

const paymentIntent = {
  amount_received: 1_080,
  id: "pi_test",
  last_payment_error: null,
  latest_charge: {
    amount_refunded: 400,
    disputed: false,
    id: "ch_test",
    object: "charge",
  },
  livemode: false,
  metadata: { medusa_order_id: "order_test" },
  object: "payment_intent",
  status: "succeeded",
};

const taxAssociation = {
  calculation: "taxcalc_test",
  id: "taxa_test",
  object: "tax.association",
  payment_intent: "pi_test",
  tax_transaction_attempts: [
    {
      committed: { transaction: "tax_sale" },
      source: "pi_test",
      status: "committed",
    },
    {
      committed: { transaction: "tax_refund" },
      source: "re_test",
      status: "committed",
    },
  ],
};

const refund = {
  amount: 400,
  currency: "usd",
  failure_reason: null,
  id: "re_test",
  object: "refund",
  payment_intent: "pi_test",
  status: "succeeded",
};

const refundList = {
  data: [refund],
  has_more: false,
  object: "list",
  url: "/v1/refunds",
};

const dispute = {
  amount: 400,
  currency: "usd",
  id: "du_test",
  livemode: false,
  object: "dispute",
  payment_intent: "pi_test",
  status: "needs_response",
};

const clientWith = ({
  associationFind = jest.fn().mockResolvedValue(taxAssociation),
  disputeRetrieve = jest.fn().mockResolvedValue(dispute),
  intentRetrieve = jest.fn().mockResolvedValue(paymentIntent),
  refundListRead = jest.fn().mockResolvedValue(refundList),
  refundRetrieve = jest.fn().mockResolvedValue(refund),
}: {
  associationFind?: jest.Mock;
  disputeRetrieve?: jest.Mock;
  intentRetrieve?: jest.Mock;
  refundListRead?: jest.Mock;
  refundRetrieve?: jest.Mock;
} = {}): StripeEvidenceClient =>
  ({
    disputes: { retrieve: disputeRetrieve },
    paymentIntents: { retrieve: intentRetrieve },
    refunds: { list: refundListRead, retrieve: refundRetrieve },
    tax: { associations: { find: associationFind } },
  }) as unknown as StripeEvidenceClient;

const readerWith = (
  client: StripeEvidenceClient,
  overrides: Partial<Parameters<typeof createStripeEvidenceReader>[0]> = {},
) =>
  createStripeEvidenceReader({
    client,
    timeoutMs: 8_000,
    ...overrides,
  });

describe("Stripe evidence safe-read client", () => {
  it("returns a validated evidence snapshot with bounded request options", async () => {
    const client = clientWith();

    await expect(
      readerWith(client).readEvidence({
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      }),
    ).resolves.toEqual({
      association: {
        attempts: [
          {
            source: "pi_test",
            status: "committed",
            transactionId: "tax_sale",
          },
          {
            source: "re_test",
            status: "committed",
            transactionId: "tax_refund",
          },
        ],
        calculationId: "taxcalc_test",
        id: "taxa_test",
        paymentIntentId: "pi_test",
      },
      intent: {
        amountReceived: 1_080,
        charge: {
          amountRefunded: 400,
          disputed: false,
          id: "ch_test",
        },
        id: "pi_test",
        lastPaymentErrorCode: null,
        livemode: false,
        orderId: "order_test",
        status: "succeeded",
      },
      refunds: [
        {
          amount: 400,
          failureReason: null,
          id: "re_test",
          status: "succeeded",
        },
      ],
      refundsTruncated: false,
    });
    expect(client.paymentIntents.retrieve).toHaveBeenCalledWith(
      "pi_test",
      { expand: ["latest_charge"] },
      expect.objectContaining({
        maxNetworkRetries: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(client.tax.associations.find).toHaveBeenCalledWith(
      { payment_intent: "pi_test" },
      expect.objectContaining({ maxNetworkRetries: 0 }),
    );
    expect(client.refunds.list).toHaveBeenCalledWith(
      { limit: 100, payment_intent: "pi_test" },
      expect.objectContaining({ maxNetworkRetries: 0 }),
    );
  });

  it("uses one decreasing deadline for concurrent evidence reads", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100)
      .mockReturnValueOnce(1_200)
      .mockReturnValueOnce(1_300);
    const client = clientWith();

    try {
      await readerWith(client).readEvidence({
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      });
    } finally {
      now.mockRestore();
    }

    expect(
      (client.paymentIntents.retrieve as jest.Mock).mock.calls[0]?.[2],
    ).toMatchObject({ timeout: 7_900 });
    expect(
      (client.tax.associations.find as jest.Mock).mock.calls[0]?.[1],
    ).toMatchObject({ timeout: 7_800 });
    expect((client.refunds.list as jest.Mock).mock.calls[0]?.[1]).toMatchObject(
      { timeout: 7_700 },
    );
  });

  it("caches the validated intent within one lifecycle deadline", async () => {
    const client = clientWith();
    const reader = readerWith(client);

    await reader.readIntent("pi_test");
    await reader.readEvidence({
      paymentIntentId: "pi_test",
      provider: "stripe_tax",
    });

    expect(client.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
  });

  it("skips the association read for TaxRate.io evidence", async () => {
    const client = clientWith();

    await expect(
      readerWith(client).readEvidence({
        paymentIntentId: "pi_test",
        provider: "taxrate_io",
      }),
    ).resolves.toMatchObject({ association: null });
    expect(client.tax.associations.find).not.toHaveBeenCalled();
  });

  it("skips the association read when tax collection was disabled", async () => {
    const client = clientWith();

    await expect(
      readerWith(client).readEvidence({
        paymentIntentId: "pi_test",
        provider: null,
      }),
    ).resolves.toMatchObject({ association: null });
    expect(client.tax.associations.find).not.toHaveBeenCalled();
  });

  it.each([
    ["retrieve_intent", "transport", { type: "StripeConnectionError" }],
    ["find_association", "status", { statusCode: 503 }],
    ["list_refunds", "status", { statusCode: 500 }],
    ["retrieve_refund", "status", { statusCode: 408 }],
    ["retrieve_dispute", "status", { statusCode: 425 }],
  ] as const)(
    "retries one transient %s read with sanitized telemetry",
    async (operation, reason, providerError) => {
      const onRetry = jest.fn();
      const retryingRequest = jest
        .fn()
        .mockRejectedValueOnce(providerError)
        .mockResolvedValueOnce(
          operation === "retrieve_intent"
            ? paymentIntent
            : operation === "find_association"
              ? taxAssociation
              : operation === "list_refunds"
                ? refundList
                : operation === "retrieve_refund"
                  ? refund
                  : dispute,
        );
      const client = clientWith({
        ...(operation === "find_association"
          ? { associationFind: retryingRequest }
          : {}),
        ...(operation === "retrieve_dispute"
          ? { disputeRetrieve: retryingRequest }
          : {}),
        ...(operation === "retrieve_intent"
          ? { intentRetrieve: retryingRequest }
          : {}),
        ...(operation === "list_refunds"
          ? { refundListRead: retryingRequest }
          : {}),
        ...(operation === "retrieve_refund"
          ? { refundRetrieve: retryingRequest }
          : {}),
      });
      const reader = readerWith(client, { onRetry });
      if (operation === "retrieve_refund") {
        await reader.readLifecycleObject({
          eventType: "refund.updated",
          objectId: "re_test",
        });
      } else if (operation === "retrieve_dispute") {
        await reader.readLifecycleObject({
          eventType: "charge.dispute.updated",
          objectId: "du_test",
        });
      } else {
        await reader.readEvidence({
          paymentIntentId: "pi_test",
          provider: "stripe_tax",
        });
      }
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 2,
        operation,
        reason,
        totalAttempts: 2,
      });
      expect(retryingRequest).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps rate limits single-attempt and redacts provider messages", async () => {
    const onRetry = jest.fn();
    const intentRetrieve = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "true" },
      message: "provider detail must stay private",
      statusCode: 429,
    });

    await expect(
      readerWith(clientWith({ intentRetrieve }), { onRetry }).readIntent(
        "pi_test",
      ),
    ).rejects.toEqual(new StripeEvidenceClientError("provider_unavailable"));
    expect(intentRetrieve).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("honors Stripe's explicit retry opt-out", async () => {
    const onRetry = jest.fn();
    const associationFind = jest.fn().mockRejectedValue({
      headers: { "stripe-should-retry": "false" },
      statusCode: 503,
    });

    await expect(
      readerWith(clientWith({ associationFind }), { onRetry }).readEvidence({
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(associationFind).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each([
    { ...paymentIntent, object: "charge" },
    { ...paymentIntent, latest_charge: "ch_test" },
    {
      ...paymentIntent,
      latest_charge: { ...paymentIntent.latest_charge, amount_refunded: 1_081 },
    },
    { ...paymentIntent, metadata: { medusa_order_id: "unsafe" } },
    { ...paymentIntent, status: "unknown" },
  ])("rejects malformed PaymentIntent evidence", async (response) => {
    const intentRetrieve = jest.fn().mockResolvedValue(response);

    await expect(
      readerWith(clientWith({ intentRetrieve })).readIntent("pi_test"),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    { ...taxAssociation, object: "tax.calculation" },
    { ...taxAssociation, payment_intent: "pi_other" },
    {
      ...taxAssociation,
      tax_transaction_attempts: [{ source: "pi_test", status: "committed" }],
    },
    {
      ...taxAssociation,
      tax_transaction_attempts: [
        {
          errored: { reason: "unknown" },
          source: "pi_test",
          status: "errored",
        },
      ],
    },
  ])("rejects malformed Tax association evidence", async (response) => {
    const associationFind = jest.fn().mockResolvedValue(response);

    await expect(
      readerWith(clientWith({ associationFind })).readEvidence({
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([
    { ...refundList, object: "refund" },
    { ...refundList, data: [refund, refund] },
    { ...refundList, data: [{ ...refund, payment_intent: "pi_other" }] },
    { ...refundList, data: [{ ...refund, status: "unknown" }] },
    { ...refundList, data: Array.from({ length: 101 }, () => refund) },
  ])("rejects malformed or oversized refund evidence", async (response) => {
    const refundListRead = jest.fn().mockResolvedValue(response);

    await expect(
      readerWith(clientWith({ refundListRead })).readEvidence({
        paymentIntentId: "pi_test",
        provider: "stripe_tax",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects malformed lifecycle objects before reconciliation", async () => {
    const refundRetrieve = jest.fn().mockResolvedValue({
      ...refund,
      currency: "USD",
    });

    await expect(
      readerWith(clientWith({ refundRetrieve })).readLifecycleObject({
        eventType: "refund.updated",
        objectId: "re_test",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([0, -1, 30_001, 1.5])(
    "rejects an invalid timeout of %p ms",
    (timeoutMs) => {
      expect(() =>
        createStripeEvidenceReader({
          client: clientWith(),
          timeoutMs,
        }),
      ).toThrow("invalid_request");
    },
  );

  it("fails before a provider call once the shared deadline expires", async () => {
    const now = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(9_001);
    const client = clientWith();

    try {
      await expect(readerWith(client).readIntent("pi_test")).rejects.toEqual(
        new StripeEvidenceClientError("deadline_exceeded"),
      );
    } finally {
      now.mockRestore();
    }
    expect(client.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});
