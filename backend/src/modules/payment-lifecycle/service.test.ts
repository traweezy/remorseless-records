import { MedusaError } from "@medusajs/framework/utils"

import type {
  RecordStripeLifecycleEventInput,
  StripeLifecycleRecord,
} from "../../lib/payment-lifecycle/contracts"
import PaymentLifecycleModuleService from "./service"

const eventDate = new Date("2026-08-30T20:00:00.000Z")
const receivedDate = new Date("2026-08-30T20:00:01.000Z")

const receiptInput = (): RecordStripeLifecycleEventInput => ({
  amountMinor: 2_500,
  chargeId: "ch_01CHARGE",
  currencyCode: "usd",
  eventCreatedAt: eventDate,
  eventType: "refund.created",
  livemode: false,
  objectId: "re_01REFUND",
  paymentIntentId: "pi_01PAYMENT",
  providerEventId: "evt_01EVENT",
  providerObjectStatus: "succeeded",
})

const persistedRecord = (
  overrides: Partial<StripeLifecycleRecord> = {}
): StripeLifecycleRecord => ({
  amount_minor: 2_500,
  attempt_count: 0,
  charge_id: "ch_01CHARGE",
  currency_code: "usd",
  event_created_at: eventDate,
  event_type: "refund.created",
  id: "stripelinevt_01EVENT",
  last_error_code: null,
  livemode: false,
  metadata: {},
  next_retry_at: null,
  object_id: "re_01REFUND",
  order_id: null,
  payment_intent_id: "pi_01PAYMENT",
  processed_at: null,
  processing_started_at: null,
  provider_event_id: "evt_01EVENT",
  provider_object_status: "succeeded",
  received_at: receivedDate,
  status: "received",
  ...overrides,
})

type ServiceHarness = PaymentLifecycleModuleService & {
  createStripeLifecycleEvents: jest.Mock
  listStripeLifecycleEvents: jest.Mock
  retrieveStripeLifecycleEvent: jest.Mock
  updateStripeLifecycleEvents: jest.Mock
}

const serviceHarness = (
  record: StripeLifecycleRecord = persistedRecord()
): ServiceHarness => {
  const manager = {}
  return Object.assign(Object.create(PaymentLifecycleModuleService.prototype), {
    baseRepository_: {
      getFreshManager: jest.fn(() => manager),
      transaction: jest.fn(
        async (callback: (transactionManager: unknown) => unknown) =>
          callback(manager)
      ),
    },
    createStripeLifecycleEvents: jest.fn(
      async ([input]: [Record<string, unknown>]) => [
        { id: "stripelinevt_01EVENT", ...input },
      ]
    ),
    listStripeLifecycleEvents: jest.fn(async () => []),
    retrieveStripeLifecycleEvent: jest.fn(async () => record),
    updateStripeLifecycleEvents: jest.fn(
      async ([update]: [Record<string, unknown>]) => [{ ...record, ...update }]
    ),
  }) as ServiceHarness
}

describe("Payment lifecycle service persistence boundaries", () => {
  it("creates exactly one complete receipt and rejects ambiguous acknowledgements", async () => {
    const service = serviceHarness()

    await expect(
      service.recordStripeLifecycleEvent(receiptInput())
    ).resolves.toMatchObject({
      lifecycleEvent: {
        id: "stripelinevt_01EVENT",
        provider_event_id: "evt_01EVENT",
        status: "received",
      },
      replayed: false,
    })

    service.createStripeLifecycleEvents.mockResolvedValue([
      persistedRecord(),
      persistedRecord({ id: "stripelinevt_02EVENT" }),
    ])
    await expect(
      service.recordStripeLifecycleEvent(receiptInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("returns an exact persisted replay without writing", async () => {
    const service = serviceHarness()
    service.listStripeLifecycleEvents.mockResolvedValue([persistedRecord()])

    await expect(
      service.recordStripeLifecycleEvent(receiptInput())
    ).resolves.toEqual({
      lifecycleEvent: persistedRecord(),
      replayed: true,
    })

    expect(service.createStripeLifecycleEvents).not.toHaveBeenCalled()
  })

  it("rejects a provider event ID replay with different immutable data", async () => {
    const service = serviceHarness()
    service.listStripeLifecycleEvents.mockResolvedValue([
      persistedRecord({ amount_minor: 9_999 }),
    ])

    await expect(
      service.recordStripeLifecycleEvent(receiptInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
    expect(service.createStripeLifecycleEvents).not.toHaveBeenCalled()
  })

  it("rejects an ambiguous provider event replay query", async () => {
    const service = serviceHarness()
    service.listStripeLifecycleEvents.mockResolvedValue([
      persistedRecord(),
      persistedRecord({ id: "stripelinevt_02EVENT" }),
    ])

    await expect(
      service.recordStripeLifecycleEvent(receiptInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
    expect(service.createStripeLifecycleEvents).not.toHaveBeenCalled()
  })

  it("rejects malformed stored state and mismatched creation acknowledgements", async () => {
    const malformedService = serviceHarness()
    malformedService.listStripeLifecycleEvents.mockResolvedValue([
      { ...persistedRecord(), attempt_count: "0" },
    ])

    await expect(
      malformedService.recordStripeLifecycleEvent(receiptInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const mismatchedService = serviceHarness()
    mismatchedService.createStripeLifecycleEvents.mockResolvedValue([
      persistedRecord({ provider_event_id: "evt_DIFFERENT" }),
    ])
    await expect(
      mismatchedService.recordStripeLifecycleEvent(receiptInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("increments processing attempts and validates the persisted acknowledgement", async () => {
    const service = serviceHarness(persistedRecord({ attempt_count: 2 }))

    await expect(
      service.markStripeLifecycleEventProcessing("stripelinevt_01EVENT")
    ).resolves.toMatchObject({ attempt_count: 3, status: "processing" })
    expect(service.updateStripeLifecycleEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          attempt_count: 3,
          id: "stripelinevt_01EVENT",
          status: "processing",
        }),
      ],
      expect.any(Object)
    )

    service.updateStripeLifecycleEvents.mockResolvedValue([
      persistedRecord({ attempt_count: 2, status: "processing" }),
    ])
    await expect(
      service.markStripeLifecycleEventProcessing("stripelinevt_01EVENT")
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("rejects immutable drift and multiple processing acknowledgements", async () => {
    const service = serviceHarness(persistedRecord({ attempt_count: 2 }))
    service.updateStripeLifecycleEvents.mockImplementation(
      async ([update]: [Record<string, unknown>]) => [
        { ...persistedRecord({ amount_minor: 2_501 }), ...update },
      ]
    )

    await expect(
      service.markStripeLifecycleEventProcessing("stripelinevt_01EVENT")
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    service.updateStripeLifecycleEvents.mockResolvedValue([
      persistedRecord({ attempt_count: 3, status: "processing" }),
      persistedRecord({
        attempt_count: 3,
        id: "stripelinevt_02EVENT",
        status: "processing",
      }),
    ])
    await expect(
      service.markStripeLifecycleEventProcessing("stripelinevt_01EVENT")
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("rejects invalid completion metadata before retrieving persisted state", async () => {
    const service = serviceHarness()

    await expect(
      service.completeStripeLifecycleEvent({
        id: "stripelinevt_01EVENT",
        metadata: { provider_payload: { secret: true } },
        providerObjectStatus: "succeeded",
        status: "processed",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(service.retrieveStripeLifecycleEvent).not.toHaveBeenCalled()
  })

  it("makes identical terminal completion idempotent and rejects conflicts", async () => {
    const terminal = persistedRecord({
      metadata: { tax_evidence_found: true },
      order_id: "order_01ORDER",
      processed_at: new Date("2026-08-30T20:05:00.000Z"),
      status: "processed",
    })
    const service = serviceHarness(terminal)
    const completion = {
      id: "stripelinevt_01EVENT",
      metadata: { tax_evidence_found: true },
      orderId: "order_01ORDER",
      providerObjectStatus: "succeeded",
      status: "processed" as const,
    }

    await expect(
      service.completeStripeLifecycleEvent(completion)
    ).resolves.toEqual(terminal)
    expect(service.updateStripeLifecycleEvents).not.toHaveBeenCalled()

    await expect(
      service.completeStripeLifecycleEvent({
        ...completion,
        status: "ignored",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
  })

  it("persists a bounded retry and rejects a mismatched failure acknowledgement", async () => {
    const service = serviceHarness(
      persistedRecord({ attempt_count: 2, status: "processing" })
    )

    await expect(
      service.markStripeLifecycleEventFailed(
        "stripelinevt_01EVENT",
        "stripe_timeout"
      )
    ).resolves.toMatchObject({
      last_error_code: "stripe_timeout",
      status: "failed",
    })

    service.updateStripeLifecycleEvents.mockResolvedValue([
      persistedRecord({
        attempt_count: 2,
        last_error_code: "different_error",
        next_retry_at: new Date("2026-08-30T20:10:00.000Z"),
        status: "failed",
      }),
    ])
    await expect(
      service.markStripeLifecycleEventFailed(
        "stripelinevt_01EVENT",
        "stripe_timeout"
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })
})
