import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import Stripe from "stripe";

import {
  PAYMENT_LIFECYCLE_MODULE,
  STRIPE_LIFECYCLE_RECEIVED_EVENT,
} from "../../../../modules/payment-lifecycle/constants";

import { POST } from "./route";

jest.mock("../../../../lib/constants", () => ({
  STRIPE_API_KEY: "sk_test_lifecycle",
  STRIPE_LIFECYCLE_WEBHOOK_SECRET: "whsec_lifecycle_unit_test",
}));

const secret = "whsec_lifecycle_unit_test";

type ResponseState = {
  body: unknown;
  headers: Record<string, string>;
  status: number;
};

const responseFixture = (): {
  res: MedusaResponse;
  state: ResponseState;
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 };
  const response = {} as MedusaResponse;
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value;
    return response;
  }) as MedusaResponse["setHeader"];
  response.status = jest.fn((status: number) => {
    state.status = status;
    return response;
  }) as MedusaResponse["status"];
  response.json = jest.fn((body: unknown) => {
    state.body = body;
    return response;
  }) as MedusaResponse["json"];
  return { res: response, state };
};

const signedPayload = ({
  eventType = "refund.created",
}: {
  eventType?: string;
} = {}) => {
  const payload = JSON.stringify({
    created: 1_750_000_000,
    data: {
      object: {
        amount: 2_500,
        charge: "ch_01CHARGE",
        currency: "usd",
        id: "re_01REFUND",
        livemode: false,
        payment_intent: "pi_01PAYMENT",
        status: "succeeded",
      },
    },
    id: "evt_01LIFECYCLE",
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type: eventType,
  });
  return {
    payload,
    signature: Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    }),
  };
};

const requestFixture = ({
  signature,
  lifecycleStatus = "received",
  payload,
}: {
  signature: string;
  lifecycleStatus?: string;
  payload: string;
}) => {
  const lifecycleService = {
    markStripeLifecycleEventFailed: jest.fn(async () => undefined),
    recordStripeLifecycleEvent: jest.fn(async () => ({
      lifecycleEvent: {
        id: "stripelinevt_01",
        status: lifecycleStatus,
      },
      replayed: lifecycleStatus !== "received",
    })),
  };
  const eventBus = { emit: jest.fn(async () => undefined) };
  const resolve = jest.fn((key: string) => {
    if (key === PAYMENT_LIFECYCLE_MODULE) {
      return lifecycleService;
    }
    if (key === Modules.EVENT_BUS) {
      return eventBus;
    }
    throw new Error(`Unexpected dependency: ${key}`);
  });
  const req = {
    headers: { "stripe-signature": signature },
    rawBody: Buffer.from(payload),
    scope: { resolve },
  } as unknown as MedusaRequest;
  return { eventBus, lifecycleService, req };
};

describe("POST /webhooks/stripe/lifecycle", () => {
  it("persists and asynchronously queues a signed refund event", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      payload: signed.payload,
      signature: signed.signature,
    });
    const { res, state } = responseFixture();

    await POST(request.req, res);

    expect(request.lifecycleService.recordStripeLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "refund.created",
        objectId: "re_01REFUND",
        providerEventId: "evt_01LIFECYCLE",
      }),
    );
    expect(request.eventBus.emit).toHaveBeenCalledWith({
      name: STRIPE_LIFECYCLE_RECEIVED_EVENT,
      data: { id: "stripelinevt_01" },
    });
    expect(state).toEqual({
      body: { received: true, replayed: false },
      headers: { "cache-control": "no-store" },
      status: 200,
    });
  });

  it("acknowledges terminal event replays without queueing again", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      lifecycleStatus: "processed",
      payload: signed.payload,
      signature: signed.signature,
    });
    const { res, state } = responseFixture();

    await POST(request.req, res);

    expect(request.eventBus.emit).not.toHaveBeenCalled();
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ received: true, replayed: true });
  });

  it("records a retryable failure when the async queue is unavailable", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      payload: signed.payload,
      signature: signed.signature,
    });
    request.eventBus.emit.mockRejectedValueOnce(new Error("queue unavailable"));
    const { res, state } = responseFixture();

    await POST(request.req, res);

    expect(
      request.lifecycleService.markStripeLifecycleEventFailed,
    ).toHaveBeenCalledWith("stripelinevt_01", "event_bus_unavailable");
    expect(state.status).toBe(500);
    expect(state.body).toEqual({
      type: "webhook_processing_unavailable",
      message: "The webhook event could not be queued.",
    });
  });

  it("rejects invalid signatures before resolving application services", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      payload: signed.payload,
      signature: "invalid-signature",
    });
    const { res, state } = responseFixture();

    await POST(request.req, res);

    expect(request.lifecycleService.recordStripeLifecycleEvent).not.toHaveBeenCalled();
    expect(state.status).toBe(400);
    expect(state.body).toEqual({
      type: "invalid_webhook",
      message: "The webhook signature or payload is invalid.",
    });
  });
});
