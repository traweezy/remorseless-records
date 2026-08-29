import type Stripe from "stripe";

import { reconcileTaxQuoteEvidence } from "../tax-control/evidence-reconciliation";
import { processStripeLifecycleEvent } from "./process-stripe-event";

jest.mock("../tax-control/evidence-reconciliation", () => ({
  reconcileTaxQuoteEvidence: jest.fn(),
}));

const reconcileMock =
  reconcileTaxQuoteEvidence as jest.MockedFunction<
    typeof reconcileTaxQuoteEvidence
  >;

const lifecycleEvent = {
  amount_minor: 2_500,
  attempt_count: 1,
  charge_id: "ch_01CHARGE",
  currency_code: "usd",
  event_type: "refund.created",
  id: "stripelinevt_01",
  livemode: false,
  metadata: {},
  object_id: "re_01REFUND",
  payment_intent_id: "pi_01PAYMENT",
  status: "processing",
};

const fixture = ({
  currentObject = {
    amount: 2_500,
    charge: "ch_01CHARGE",
    currency: "usd",
    id: "re_01REFUND",
    payment_intent: "pi_01PAYMENT",
    status: "succeeded",
  },
  record = lifecycleEvent,
}: {
  currentObject?: Record<string, unknown>;
  record?: Record<string, unknown>;
} = {}) => {
  const lifecycleService = {
    completeStripeLifecycleEvent: jest.fn(async () => undefined),
    markStripeLifecycleEventFailed: jest.fn(async () => undefined),
    markStripeLifecycleEventProcessing: jest.fn(async () => record),
  };
  const client = {
    disputes: { retrieve: jest.fn() },
    paymentIntents: {
      retrieve: jest.fn(async () => ({
        metadata: { medusa_order_id: "order_01ORDER" },
      })),
    },
    refunds: {
      list: jest.fn(),
      retrieve: jest.fn(async () => currentObject),
    },
    tax: { associations: { find: jest.fn() } },
  } as unknown as Stripe;
  const taxControlService = {} as Parameters<
    typeof processStripeLifecycleEvent
  >[0]["taxControlService"];

  return {
    client,
    lifecycleService: lifecycleService as unknown as Parameters<
      typeof processStripeLifecycleEvent
    >[0]["lifecycleService"],
    lifecycleServiceMocks: lifecycleService,
    taxControlService,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  reconcileMock.mockResolvedValue({
    associationStatus: "not_applicable",
    evidenceFound: true,
    paymentIntentId: "pi_01PAYMENT",
    status: "partially_refunded",
  });
});

describe("Stripe lifecycle event processing", () => {
  it("does not call Stripe again for a terminal replay", async () => {
    const input = fixture({
      record: {
        ...lifecycleEvent,
        metadata: { tax_evidence_found: true },
        status: "processed",
      },
    });

    await expect(
      processStripeLifecycleEvent({
        client: input.client,
        eventId: "stripelinevt_01",
        lifecycleService: input.lifecycleService,
        taxControlService: input.taxControlService,
      }),
    ).resolves.toEqual({ evidenceFound: true, status: "processed" });

    expect(input.client.refunds.retrieve).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(
      input.lifecycleServiceMocks.completeStripeLifecycleEvent,
    ).not.toHaveBeenCalled();
  });

  it("accepts the current Refund shape and reconciles tracked evidence", async () => {
    const input = fixture();

    await expect(
      processStripeLifecycleEvent({
        client: input.client,
        eventId: "stripelinevt_01",
        lifecycleService: input.lifecycleService,
        taxControlService: input.taxControlService,
      }),
    ).resolves.toEqual({ evidenceFound: true, status: "processed" });

    expect(reconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_01ORDER",
        paymentIntentId: "pi_01PAYMENT",
      }),
    );
    expect(
      input.lifecycleServiceMocks.completeStripeLifecycleEvent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stripelinevt_01",
        orderId: "order_01ORDER",
        providerObjectStatus: "succeeded",
        status: "processed",
      }),
    );
  });

  it("records non-PaymentIntent refunds as ignored without retrying", async () => {
    const input = fixture({
      currentObject: {
        amount: 2_500,
        currency: "usd",
        id: "re_01REFUND",
        livemode: false,
        payment_intent: null,
        status: "succeeded",
      },
      record: { ...lifecycleEvent, payment_intent_id: null },
    });

    await expect(
      processStripeLifecycleEvent({
        client: input.client,
        eventId: "stripelinevt_01",
        lifecycleService: input.lifecycleService,
        taxControlService: input.taxControlService,
      }),
    ).resolves.toEqual({ evidenceFound: false, status: "ignored" });

    expect(reconcileMock).not.toHaveBeenCalled();
    expect(
      input.lifecycleServiceMocks.completeStripeLifecycleEvent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ignored_reason: "payment_intent_missing",
        }),
        status: "ignored",
      }),
    );
  });

  it("fails closed when immutable provider object data changes", async () => {
    const input = fixture({
      currentObject: {
        amount: 9_999,
        currency: "usd",
        id: "re_01REFUND",
        livemode: false,
        payment_intent: "pi_01PAYMENT",
        status: "succeeded",
      },
    });

    await expect(
      processStripeLifecycleEvent({
        client: input.client,
        eventId: "stripelinevt_01",
        lifecycleService: input.lifecycleService,
        taxControlService: input.taxControlService,
      }),
    ).rejects.toThrow("stripe_object_integrity_mismatch");
    expect(
      input.lifecycleServiceMocks.markStripeLifecycleEventFailed,
    ).toHaveBeenCalledWith(
      "stripelinevt_01",
      "stripe_object_integrity_mismatch",
    );
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("fails closed when a provider object exposes a different mode", async () => {
    const input = fixture({
      currentObject: {
        amount: 2_500,
        currency: "usd",
        id: "re_01REFUND",
        livemode: true,
        payment_intent: "pi_01PAYMENT",
        status: "succeeded",
      },
    });

    await expect(
      processStripeLifecycleEvent({
        client: input.client,
        eventId: "stripelinevt_01",
        lifecycleService: input.lifecycleService,
        taxControlService: input.taxControlService,
      }),
    ).rejects.toThrow("stripe_object_integrity_mismatch");
    expect(
      input.lifecycleServiceMocks.markStripeLifecycleEventFailed,
    ).toHaveBeenCalledWith(
      "stripelinevt_01",
      "stripe_object_integrity_mismatch",
    );
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
