import { stripeLifecycleEventIsDue } from "./reconcile-stripe-lifecycle-events"

const now = new Date("2026-08-29T12:00:00.000Z")

describe("Stripe lifecycle scheduled recovery", () => {
  it.each([
    [
      "new receipt",
      {
        next_retry_at: null,
        processing_started_at: null,
        status: "received",
      },
      true,
    ],
    [
      "due failed receipt",
      {
        next_retry_at: new Date("2026-08-29T11:59:59.000Z"),
        processing_started_at: null,
        status: "failed",
      },
      true,
    ],
    [
      "backed-off failed receipt",
      {
        next_retry_at: new Date("2026-08-29T12:00:01.000Z"),
        processing_started_at: null,
        status: "failed",
      },
      false,
    ],
    [
      "stale processing receipt",
      {
        next_retry_at: null,
        processing_started_at: new Date("2026-08-29T11:45:00.000Z"),
        status: "processing",
      },
      true,
    ],
    [
      "active processing receipt",
      {
        next_retry_at: null,
        processing_started_at: new Date("2026-08-29T11:45:01.000Z"),
        status: "processing",
      },
      false,
    ],
    [
      "terminal receipt",
      {
        next_retry_at: null,
        processing_started_at: null,
        status: "processed",
      },
      false,
    ],
  ])("classifies %s", (_label, record, expected) => {
    expect(stripeLifecycleEventIsDue(record, now)).toBe(expected)
  })

  it.each([
    [
      "unknown status",
      {
        next_retry_at: null,
        processing_started_at: null,
        status: "future",
      },
    ],
    [
      "coercive retry timestamp",
      {
        next_retry_at: "2026-08-29T11:59:59.000Z",
        processing_started_at: null,
        status: "failed",
      },
    ],
    [
      "invalid processing timestamp",
      {
        next_retry_at: null,
        processing_started_at: new Date("invalid"),
        status: "processing",
      },
    ],
  ])("rejects %s", (_label, record) => {
    expect(() => stripeLifecycleEventIsDue(record, now)).toThrow(
      /Stripe lifecycle/
    )
  })

  it("rejects an invalid reconciliation clock", () => {
    expect(() =>
      stripeLifecycleEventIsDue(
        {
          next_retry_at: null,
          processing_started_at: null,
          status: "received",
        },
        new Date("invalid")
      )
    ).toThrow("The Stripe lifecycle reconciliation clock is invalid.")
  })
})
