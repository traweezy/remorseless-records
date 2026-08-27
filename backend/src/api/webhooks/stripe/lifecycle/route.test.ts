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

import { createStripeLifecyclePost, POST } from "./route";

jest.mock("../../../../lib/constants", () => ({
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
  response.type = jest.fn((value: string) => {
    state.headers["content-type"] = value;
    return response;
  }) as MedusaResponse["type"];
  response.status = jest.fn((status: number) => {
    state.status = status;
    return response;
  }) as MedusaResponse["status"];
  response.json = jest.fn((body: unknown) => {
    state.body = body;
    return response;
  }) as MedusaResponse["json"];
  response.locals = {};
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
    headers: {
      "stripe-signature": signature,
      "x-request-id": "webhook-contract-test",
      traceparent:
        "00-11111111111111111111111111111111-2222222222222222-01",
    },
    path: "/webhooks/stripe/lifecycle",
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
    expect(state.status).toBe(503);
    expect(state.headers).toEqual({
      "cache-control": "no-store",
      "content-type": "application/problem+json",
      "x-request-id": "webhook-contract-test",
      traceparent: expect.stringMatching(
        /^00-11111111111111111111111111111111-[0-9a-f]{16}-01$/u,
      ),
    });
    expect(state.body).toEqual({
      type:
        "https://remorselessrecords.com/problems/webhook_processing_unavailable",
      title: "Payment lifecycle processing is unavailable",
      status: 503,
      detail: "The webhook event could not be queued.",
      code: "webhook_processing_unavailable",
      instance: "/webhooks/stripe/lifecycle",
      request_id: "webhook-contract-test",
      trace_id: "11111111111111111111111111111111",
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
      type: "https://remorselessrecords.com/problems/invalid_webhook",
      title: "Invalid payment lifecycle webhook",
      status: 400,
      detail: "The webhook signature or payload is invalid.",
      code: "invalid_webhook",
      instance: "/webhooks/stripe/lifecycle",
      request_id: "webhook-contract-test",
      trace_id: "11111111111111111111111111111111",
    });
  });

  it("returns a retryable problem when the webhook secret is unavailable", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      payload: signed.payload,
      signature: signed.signature,
    });
    const { res, state } = responseFixture();

    await createStripeLifecyclePost(undefined)(request.req, res);

    expect(request.lifecycleService.recordStripeLifecycleEvent).not.toHaveBeenCalled();
    expect(state.status).toBe(503);
    expect(state.body).toEqual(
      expect.objectContaining({
        code: "lifecycle_webhook_unavailable",
        detail: "The payment lifecycle webhook is not configured.",
        request_id: "webhook-contract-test",
        status: 503,
      }),
    );
  });

  it("redacts unexpected persistence failures and asks Stripe to retry", async () => {
    const signed = signedPayload();
    const request = requestFixture({
      payload: signed.payload,
      signature: signed.signature,
    });
    request.lifecycleService.recordStripeLifecycleEvent.mockRejectedValueOnce(
      new Error("postgresql://operator:secret@database.internal/events"),
    );
    const { res, state } = responseFixture();

    await POST(request.req, res);

    expect(state.status).toBe(503);
    expect(state.body).toEqual(
      expect.objectContaining({
        code: "webhook_processing_unavailable",
        detail:
          "The webhook event could not be recorded. Try again shortly.",
        request_id: "webhook-contract-test",
        status: 503,
      }),
    );
    expect(JSON.stringify(state.body)).not.toContain("operator:secret");
    expect(request.eventBus.emit).not.toHaveBeenCalled();
  });
});
