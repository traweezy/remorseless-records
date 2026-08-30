import {
  completeStripeLifecycleEventInputFrom,
  recordStripeLifecycleEventInputFrom,
  stripeLifecycleMetadataFrom,
  stripeLifecycleReceiptMatches,
  stripeLifecycleRecordFrom,
  stripeLifecycleRetryDelayMs,
} from "./contracts"

const receiptInput = () => ({
  amountMinor: 2_500,
  chargeId: "ch_01CHARGE",
  currencyCode: "usd",
  eventCreatedAt: new Date("2026-08-30T20:00:00.000Z"),
  eventType: "refund.created",
  livemode: false,
  objectId: "re_01REFUND",
  paymentIntentId: "pi_01PAYMENT",
  providerEventId: "evt_01EVENT",
  providerObjectStatus: "succeeded",
})

const persistedRecord = () => ({
  amount_minor: 2_500,
  attempt_count: 1,
  charge_id: "ch_01CHARGE",
  currency_code: "usd",
  event_created_at: new Date("2026-08-30T20:00:00.000Z"),
  event_type: "refund.created",
  id: "stripelinevt_01EVENT",
  last_error_code: null,
  livemode: false,
  metadata: { tax_evidence_found: true },
  next_retry_at: null,
  object_id: "re_01REFUND",
  order_id: "order_01ORDER",
  payment_intent_id: "pi_01PAYMENT",
  processed_at: null,
  processing_started_at: new Date("2026-08-30T20:01:00.000Z"),
  provider_event_id: "evt_01EVENT",
  provider_object_status: "succeeded",
  received_at: new Date("2026-08-30T20:00:01.000Z"),
  status: "processing",
})

describe("Stripe lifecycle persistence contracts", () => {
  it("normalizes a complete USD receipt and exact replay", () => {
    const input = recordStripeLifecycleEventInputFrom(receiptInput())
    const record = stripeLifecycleRecordFrom(persistedRecord())

    expect(input.currencyCode).toBe("usd")
    expect(record.metadata).toEqual({ tax_evidence_found: true })
    expect(stripeLifecycleReceiptMatches(record, input)).toBe(true)
  })

  it.each([
    ["boolean amount", { amountMinor: false }],
    ["numeric-string amount", { amountMinor: "2500" }],
    ["oversized amount", { amountMinor: 100_000_000 }],
    ["non-USD currency", { currencyCode: "eur" }],
    ["invalid date", { eventCreatedAt: new Date("invalid") }],
    ["coercive livemode", { livemode: "false" }],
    ["wrong object prefix", { objectId: "du_01DISPUTE" }],
    ["malformed optional reference", { paymentIntentId: "bad" }],
  ])("rejects %s in a new receipt", (_label, override) => {
    expect(() =>
      recordStripeLifecycleEventInputFrom({ ...receiptInput(), ...override })
    ).toThrow("Stripe lifecycle data is malformed.")
  })

  it.each([
    ["array record", []],
    ["unknown status", { status: "future" }],
    ["string attempt count", { attempt_count: "1" }],
    ["excessive attempt count", { attempt_count: 1_001 }],
    ["array metadata", { metadata: [] }],
    ["unknown metadata", { metadata: { customer_email: "private@test" } }],
    ["ambiguous date", { received_at: "2026-08-30" }],
    ["wrong event object", { object_id: "du_01DISPUTE" }],
  ])("rejects a persisted %s", (_label, override) => {
    const value = Array.isArray(override)
      ? override
      : { ...persistedRecord(), ...override }
    expect(() => stripeLifecycleRecordFrom(value)).toThrow(
      "Stripe lifecycle data is malformed."
    )
  })

  it("accepts only allowlisted bounded completion metadata", () => {
    expect(
      completeStripeLifecycleEventInputFrom({
        id: "stripelinevt_01EVENT",
        metadata: {
          ignored_reason: "tax_evidence_not_found",
          tax_association_status: "refund_failed:expired_or_canceled_card",
          tax_evidence_found: false,
          tax_evidence_status: "association_failed",
        },
        orderId: "order_01ORDER",
        providerObjectStatus: "failed",
        status: "ignored",
      })
    ).toEqual(
      expect.objectContaining({
        id: "stripelinevt_01EVENT",
        orderId: "order_01ORDER",
        status: "ignored",
      })
    )
    expect(() =>
      stripeLifecycleMetadataFrom({ provider_payload: { secret: true } })
    ).toThrow("Stripe lifecycle data is malformed.")
  })

  it("bounds exponential retry scheduling", () => {
    expect(stripeLifecycleRetryDelayMs(1)).toBe(60_000)
    expect(stripeLifecycleRetryDelayMs(2)).toBe(120_000)
    expect(stripeLifecycleRetryDelayMs(100)).toBe(3_600_000)
    expect(() => stripeLifecycleRetryDelayMs("2")).toThrow(
      "Stripe lifecycle data is malformed."
    )
  })
})
