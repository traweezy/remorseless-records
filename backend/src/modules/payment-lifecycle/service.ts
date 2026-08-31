import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import {
  completeStripeLifecycleEventInputFrom,
  recordStripeLifecycleEventInputFrom,
  stripeLifecycleErrorCodeFrom,
  stripeLifecycleEventIdFrom,
  stripeLifecycleReceiptMatches,
  stripeLifecycleRecordFrom,
  stripeLifecycleRetryDelayMs,
  type CompleteStripeLifecycleEventInput,
  type RecordStripeLifecycleEventInput,
  type StripeLifecycleRecord,
} from "../../lib/payment-lifecycle/contracts"
import StripeLifecycleEvent from "./models/stripe-lifecycle-event"

export type { RecordStripeLifecycleEventInput }

const invalidLifecycleInput = (): MedusaError =>
  new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The Stripe lifecycle request data is invalid."
  )

const unexpectedLifecycleState = (message: string): MedusaError =>
  new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)

const receiptInputFrom = (value: unknown): RecordStripeLifecycleEventInput => {
  try {
    return recordStripeLifecycleEventInputFrom(value)
  } catch {
    throw invalidLifecycleInput()
  }
}

const completionInputFrom = (
  value: unknown
): CompleteStripeLifecycleEventInput => {
  try {
    return completeStripeLifecycleEventInputFrom(value)
  } catch {
    throw invalidLifecycleInput()
  }
}

const lifecycleRecordFrom = (
  value: unknown,
  message: string
): StripeLifecycleRecord => {
  try {
    return stripeLifecycleRecordFrom(value)
  } catch {
    throw unexpectedLifecycleState(message)
  }
}

const lifecycleRecordsFrom = (
  value: unknown,
  maximumRows: number,
  message: string
): StripeLifecycleRecord[] => {
  if (!Array.isArray(value) || value.length > maximumRows) {
    throw unexpectedLifecycleState(message)
  }
  return value.map((entry) => lifecycleRecordFrom(entry, message))
}

const lifecycleMutationFrom = (
  value: unknown,
  message: string
): StripeLifecycleRecord => {
  const records = lifecycleRecordsFrom(value, 1, message)
  if (records.length !== 1) {
    throw unexpectedLifecycleState(message)
  }
  return records[0]!
}

const sameDate = (left: Date | null, right: Date | null): boolean =>
  left?.getTime() === right?.getTime()

const lifecycleStateMatches = (
  actual: StripeLifecycleRecord,
  expected: StripeLifecycleRecord
): boolean =>
  actual.amount_minor === expected.amount_minor &&
  actual.attempt_count === expected.attempt_count &&
  actual.charge_id === expected.charge_id &&
  actual.currency_code === expected.currency_code &&
  sameDate(actual.event_created_at, expected.event_created_at) &&
  actual.event_type === expected.event_type &&
  actual.id === expected.id &&
  actual.last_error_code === expected.last_error_code &&
  actual.livemode === expected.livemode &&
  metadataMatches(actual.metadata, expected.metadata) &&
  sameDate(actual.next_retry_at, expected.next_retry_at) &&
  actual.object_id === expected.object_id &&
  actual.order_id === expected.order_id &&
  actual.payment_intent_id === expected.payment_intent_id &&
  sameDate(actual.processed_at, expected.processed_at) &&
  sameDate(actual.processing_started_at, expected.processing_started_at) &&
  actual.provider_event_id === expected.provider_event_id &&
  actual.provider_object_status === expected.provider_object_status &&
  sameDate(actual.received_at, expected.received_at) &&
  actual.status === expected.status

const metadataContains = (
  existing: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean =>
  Object.entries(expected).every(([key, value]) =>
    Object.is(existing[key], value)
  )

const metadataMatches = (
  existing: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean =>
  Object.keys(existing).length === Object.keys(expected).length &&
  metadataContains(existing, expected)

class PaymentLifecycleModuleService extends MedusaService({
  StripeLifecycleEvent,
}) {
  @InjectTransactionManager()
  protected async recordStripeLifecycleEvent_(
    input: RecordStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const receipt = receiptInputFrom(input)
    const existing = lifecycleRecordsFrom(
      await this.listStripeLifecycleEvents(
        { provider_event_id: receipt.providerEventId },
        { take: 2 },
        sharedContext
      ),
      1,
      "The stored Stripe lifecycle receipt query is invalid."
    ).at(0)
    if (existing) {
      const persisted = lifecycleRecordFrom(
        existing,
        "The stored Stripe lifecycle receipt is invalid."
      )
      if (!stripeLifecycleReceiptMatches(persisted, receipt)) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The Stripe event ID is already bound to different lifecycle data."
        )
      }
      return { lifecycleEvent: persisted, replayed: true }
    }

    const receivedAt = new Date()
    const created = lifecycleMutationFrom(
      await this.createStripeLifecycleEvents(
        [
          {
            amount_minor: receipt.amountMinor,
            attempt_count: 0,
            charge_id: receipt.chargeId,
            currency_code: receipt.currencyCode,
            event_created_at: receipt.eventCreatedAt,
            event_type: receipt.eventType,
            last_error_code: null,
            livemode: receipt.livemode,
            metadata: {},
            next_retry_at: null,
            object_id: receipt.objectId,
            order_id: null,
            payment_intent_id: receipt.paymentIntentId,
            processed_at: null,
            processing_started_at: null,
            provider_event_id: receipt.providerEventId,
            provider_object_status: receipt.providerObjectStatus,
            received_at: receivedAt,
            status: "received",
          },
        ],
        sharedContext
      ),
      "The Stripe lifecycle receipt was not persisted exactly once."
    )
    const persisted = created
    if (
      persisted.status !== "received" ||
      persisted.attempt_count !== 0 ||
      persisted.provider_event_id !== receipt.providerEventId ||
      persisted.received_at.getTime() !== receivedAt.getTime() ||
      persisted.provider_object_status !== receipt.providerObjectStatus ||
      persisted.last_error_code !== null ||
      persisted.next_retry_at !== null ||
      persisted.order_id !== null ||
      persisted.processed_at !== null ||
      persisted.processing_started_at !== null ||
      !metadataMatches(persisted.metadata, {}) ||
      !stripeLifecycleReceiptMatches(persisted, receipt)
    ) {
      throw unexpectedLifecycleState(
        "The persisted Stripe lifecycle receipt does not match the request."
      )
    }
    return { lifecycleEvent: persisted, replayed: false }
  }

  @InjectManager()
  async recordStripeLifecycleEvent(
    input: RecordStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.recordStripeLifecycleEvent_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async markStripeLifecycleEventProcessing_(
    id: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    let eventId: string
    try {
      eventId = stripeLifecycleEventIdFrom(id)
    } catch {
      throw invalidLifecycleInput()
    }
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      eventId,
      {},
      sharedContext
    )
    const persisted = lifecycleRecordFrom(
      lifecycleEvent,
      "The stored Stripe lifecycle processing state is invalid."
    )
    if (persisted.status === "processed" || persisted.status === "ignored") {
      return persisted
    }

    const attemptCount = persisted.attempt_count + 1
    if (!Number.isSafeInteger(attemptCount) || attemptCount > 1_000) {
      throw unexpectedLifecycleState(
        "The Stripe lifecycle attempt counter is invalid."
      )
    }

    const processingStartedAt = new Date()
    const next = lifecycleMutationFrom(
      await this.updateStripeLifecycleEvents(
        [
          {
            attempt_count: attemptCount,
            id: eventId,
            last_error_code: null,
            next_retry_at: null,
            processing_started_at: processingStartedAt,
            status: "processing",
          },
        ],
        sharedContext
      ),
      "The Stripe lifecycle processing state was not persisted exactly once."
    )
    if (
      !lifecycleStateMatches(next, {
        ...persisted,
        attempt_count: attemptCount,
        last_error_code: null,
        next_retry_at: null,
        processing_started_at: processingStartedAt,
        status: "processing",
      })
    ) {
      throw unexpectedLifecycleState(
        "The persisted Stripe lifecycle processing state does not match the request."
      )
    }
    return next
  }

  @InjectManager()
  async markStripeLifecycleEventProcessing(
    id: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.markStripeLifecycleEventProcessing_(id, sharedContext)
  }

  @InjectTransactionManager()
  protected async completeStripeLifecycleEvent_(
    input: CompleteStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const completion = completionInputFrom(input)
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      completion.id,
      {},
      sharedContext
    )
    const persisted = lifecycleRecordFrom(
      lifecycleEvent,
      "The stored Stripe lifecycle completion state is invalid."
    )
    if (
      completion.orderId &&
      persisted.order_id &&
      completion.orderId !== persisted.order_id
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Stripe lifecycle event is already assigned to a different order."
      )
    }
    if (persisted.status === "processed" || persisted.status === "ignored") {
      if (
        persisted.status === completion.status &&
        persisted.provider_object_status === completion.providerObjectStatus &&
        (!completion.orderId || persisted.order_id === completion.orderId) &&
        metadataContains(persisted.metadata, completion.metadata)
      ) {
        return persisted
      }
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Stripe lifecycle event already has a different terminal result."
      )
    }
    const metadata = {
      ...persisted.metadata,
      ...completion.metadata,
    }
    const processedAt = new Date()
    const next = lifecycleMutationFrom(
      await this.updateStripeLifecycleEvents(
        [
          {
            id: completion.id,
            last_error_code: null,
            metadata,
            next_retry_at: null,
            order_id: completion.orderId ?? persisted.order_id,
            processed_at: processedAt,
            provider_object_status: completion.providerObjectStatus,
            status: completion.status,
          },
        ],
        sharedContext
      ),
      "The Stripe lifecycle completion state was not persisted exactly once."
    )
    if (
      !lifecycleStateMatches(next, {
        ...persisted,
        last_error_code: null,
        metadata,
        next_retry_at: null,
        order_id: completion.orderId ?? persisted.order_id,
        processed_at: processedAt,
        provider_object_status: completion.providerObjectStatus,
        status: completion.status,
      })
    ) {
      throw unexpectedLifecycleState(
        "The persisted Stripe lifecycle completion state does not match the request."
      )
    }
    return next
  }

  @InjectManager()
  async completeStripeLifecycleEvent(
    input: CompleteStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.completeStripeLifecycleEvent_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async markStripeLifecycleEventFailed_(
    id: string,
    errorCode: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    let eventId: string
    let failureCode: string
    try {
      eventId = stripeLifecycleEventIdFrom(id)
      failureCode = stripeLifecycleErrorCodeFrom(errorCode)
    } catch {
      throw invalidLifecycleInput()
    }
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      eventId,
      {},
      sharedContext
    )
    const persisted = lifecycleRecordFrom(
      lifecycleEvent,
      "The stored Stripe lifecycle failure state is invalid."
    )
    if (persisted.status === "processed" || persisted.status === "ignored") {
      return persisted
    }

    const attemptCount = Math.max(1, persisted.attempt_count)
    let nextRetryAt: Date
    try {
      nextRetryAt = new Date(
        Date.now() + stripeLifecycleRetryDelayMs(attemptCount)
      )
    } catch {
      throw unexpectedLifecycleState(
        "The Stripe lifecycle retry state is invalid."
      )
    }
    const next = lifecycleMutationFrom(
      await this.updateStripeLifecycleEvents(
        [
          {
            id: eventId,
            last_error_code: failureCode,
            next_retry_at: nextRetryAt,
            status: "failed",
          },
        ],
        sharedContext
      ),
      "The Stripe lifecycle failure state was not persisted exactly once."
    )
    if (
      !lifecycleStateMatches(next, {
        ...persisted,
        last_error_code: failureCode,
        next_retry_at: nextRetryAt,
        status: "failed",
      })
    ) {
      throw unexpectedLifecycleState(
        "The persisted Stripe lifecycle failure state does not match the request."
      )
    }
    return next
  }

  @InjectManager()
  async markStripeLifecycleEventFailed(
    id: string,
    errorCode: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.markStripeLifecycleEventFailed_(id, errorCode, sharedContext)
  }
}

export default PaymentLifecycleModuleService
