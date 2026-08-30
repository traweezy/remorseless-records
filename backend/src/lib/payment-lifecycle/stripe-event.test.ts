import type Stripe from "stripe"

import { projectStripeLifecycleEvent } from "./stripe-event"

const eventFixture = (
  type: string,
  object: Record<string, unknown>
): Stripe.Event =>
  ({
    created: 1_750_000_000,
    data: { object },
    id: "evt_01LIFECYCLE",
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type,
  }) as unknown as Stripe.Event

describe("Stripe lifecycle event projection", () => {
  it("projects refund receipts without retaining provider payloads", () => {
    const projected = projectStripeLifecycleEvent(
      eventFixture("refund.created", {
        amount: 2_500,
        charge: "ch_01CHARGE",
        currency: "USD",
        id: "re_01REFUND",
        payment_intent: "pi_01PAYMENT",
        status: "pending",
        customer_email: "must-not-be-persisted@example.com",
      })
    )

    expect(projected).toEqual({
      amountMinor: 2_500,
      chargeId: "ch_01CHARGE",
      currencyCode: "usd",
      eventCreatedAt: new Date(1_750_000_000_000),
      eventType: "refund.created",
      livemode: false,
      objectId: "re_01REFUND",
      paymentIntentId: "pi_01PAYMENT",
      providerEventId: "evt_01LIFECYCLE",
      providerObjectStatus: "pending",
    })
    expect(JSON.stringify(projected)).not.toContain("example.com")
  })

  it("projects dispute receipts with expandable references", () => {
    const projected = projectStripeLifecycleEvent(
      eventFixture("charge.dispute.updated", {
        amount: 4_200,
        charge: { id: "ch_01CHARGE" },
        currency: "usd",
        id: "du_01DISPUTE",
        payment_intent: { id: "pi_01PAYMENT" },
        status: "needs_response",
      })
    )

    expect(projected).toMatchObject({
      chargeId: "ch_01CHARGE",
      eventType: "charge.dispute.updated",
      objectId: "du_01DISPUTE",
      paymentIntentId: "pi_01PAYMENT",
      providerObjectStatus: "needs_response",
    })
  })

  it("ignores event types outside the explicit destination allowlist", () => {
    expect(
      projectStripeLifecycleEvent(
        eventFixture("customer.updated", { id: "cus_01CUSTOMER" })
      )
    ).toBeNull()
  })

  it("rejects malformed identities inside supported event types", () => {
    expect(() =>
      projectStripeLifecycleEvent(
        eventFixture("refund.failed", {
          amount: 100,
          currency: "usd",
          id: "not-a-refund",
        })
      )
    ).toThrow("identity is invalid")
  })

  it("rejects a non-Stripe dispute object prefix", () => {
    expect(() =>
      projectStripeLifecycleEvent(
        eventFixture("charge.dispute.created", {
          amount: 4_200,
          currency: "usd",
          id: "dp_01DISPUTE",
          status: "needs_response",
        })
      )
    ).toThrow("identity is invalid")
  })

  it.each([
    ["missing amount", { currency: "usd", id: "re_01REFUND" }],
    [
      "numeric-string amount",
      { amount: "2500", currency: "usd", id: "re_01REFUND" },
    ],
    ["non-USD currency", { amount: 2_500, currency: "eur", id: "re_01REFUND" }],
    [
      "malformed PaymentIntent",
      {
        amount: 2_500,
        currency: "usd",
        id: "re_01REFUND",
        payment_intent: "not-an-intent",
      },
    ],
    [
      "malformed status",
      {
        amount: 2_500,
        currency: "usd",
        id: "re_01REFUND",
        status: { value: "succeeded" },
      },
    ],
  ])("rejects %s instead of weakening immutable evidence", (_label, object) => {
    expect(() =>
      projectStripeLifecycleEvent(eventFixture("refund.updated", object))
    ).toThrow()
  })

  it("rejects a coercive event mode and an invalid provider timestamp", () => {
    const coerciveMode = eventFixture("refund.created", {
      amount: 2_500,
      currency: "usd",
      id: "re_01REFUND",
    }) as unknown as Record<string, unknown>
    coerciveMode.livemode = "false"
    expect(() =>
      projectStripeLifecycleEvent(coerciveMode as unknown as Stripe.Event)
    ).toThrow("Stripe lifecycle data is malformed")

    const invalidTimestamp = eventFixture("refund.created", {
      amount: 2_500,
      currency: "usd",
      id: "re_01REFUND",
    }) as unknown as Record<string, unknown>
    invalidTimestamp.created = Number.MAX_SAFE_INTEGER
    expect(() =>
      projectStripeLifecycleEvent(invalidTimestamp as unknown as Stripe.Event)
    ).toThrow("Stripe lifecycle data is malformed")
  })
})
