import type { Context } from "@medusajs/framework/types";
import { EntityManager } from "@medusajs/framework/mikro-orm/knex";
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";

import type {
  StripeLifecycleEventStatus,
  StripeLifecycleEventType,
} from "./constants";
import StripeLifecycleEvent from "./models/stripe-lifecycle-event";

export type RecordStripeLifecycleEventInput = {
  amountMinor: number | null;
  chargeId: string | null;
  currencyCode: string | null;
  eventCreatedAt: Date;
  eventType: StripeLifecycleEventType;
  livemode: boolean;
  objectId: string;
  paymentIntentId: string | null;
  providerEventId: string;
  providerObjectStatus: string | null;
};

type CompleteStripeLifecycleEventInput = {
  id: string;
  metadata: Record<string, unknown>;
  orderId?: string;
  providerObjectStatus: string | null;
  status: Extract<StripeLifecycleEventStatus, "ignored" | "processed">;
};

const dateValue = (value: unknown): number => new Date(String(value)).getTime();

const immutableReceiptMatches = (
  existing: Record<string, unknown>,
  input: RecordStripeLifecycleEventInput,
): boolean =>
  existing.event_type === input.eventType &&
  existing.object_id === input.objectId &&
  existing.payment_intent_id === input.paymentIntentId &&
  existing.charge_id === input.chargeId &&
  existing.livemode === input.livemode &&
  existing.amount_minor === input.amountMinor &&
  existing.currency_code === input.currencyCode &&
  dateValue(existing.event_created_at) === input.eventCreatedAt.getTime();

const retryDelayMs = (attemptCount: number): number =>
  Math.min(60 * 60 * 1_000, 60 * 1_000 * 2 ** Math.max(0, attemptCount - 1));

class PaymentLifecycleModuleService extends MedusaService({
  StripeLifecycleEvent,
}) {
  @InjectTransactionManager()
  protected async recordStripeLifecycleEvent_(
    input: RecordStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    const existing = (
      await this.listStripeLifecycleEvents(
        { provider_event_id: input.providerEventId },
        { take: 1 },
        sharedContext,
      )
    )[0];
    if (existing) {
      if (
        !immutableReceiptMatches(
          existing as unknown as Record<string, unknown>,
          input,
        )
      ) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The Stripe event ID is already bound to different lifecycle data.",
        );
      }
      return { lifecycleEvent: existing, replayed: true };
    }

    const [created] = await this.createStripeLifecycleEvents(
      [
        {
          amount_minor: input.amountMinor,
          attempt_count: 0,
          charge_id: input.chargeId,
          currency_code: input.currencyCode,
          event_created_at: input.eventCreatedAt,
          event_type: input.eventType,
          last_error_code: null,
          livemode: input.livemode,
          metadata: {},
          next_retry_at: null,
          object_id: input.objectId,
          order_id: null,
          payment_intent_id: input.paymentIntentId,
          processed_at: null,
          processing_started_at: null,
          provider_event_id: input.providerEventId,
          provider_object_status: input.providerObjectStatus,
          received_at: new Date(),
          status: "received",
        },
      ],
      sharedContext,
    );
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Stripe lifecycle receipt was not persisted.",
      );
    }
    return { lifecycleEvent: created, replayed: false };
  }

  @InjectManager()
  async recordStripeLifecycleEvent(
    input: RecordStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    return this.recordStripeLifecycleEvent_(input, sharedContext);
  }

  @InjectTransactionManager()
  protected async markStripeLifecycleEventProcessing_(
    id: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      id,
      {},
      sharedContext,
    );
    if (
      lifecycleEvent.status === "processed" ||
      lifecycleEvent.status === "ignored"
    ) {
      return lifecycleEvent;
    }

    const [updated] = await this.updateStripeLifecycleEvents(
      [
        {
          attempt_count: lifecycleEvent.attempt_count + 1,
          id,
          last_error_code: null,
          next_retry_at: null,
          processing_started_at: new Date(),
          status: "processing",
        },
      ],
      sharedContext,
    );
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Stripe lifecycle processing state was not persisted.",
      );
    }
    return updated;
  }

  @InjectManager()
  async markStripeLifecycleEventProcessing(
    id: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    return this.markStripeLifecycleEventProcessing_(id, sharedContext);
  }

  @InjectTransactionManager()
  protected async completeStripeLifecycleEvent_(
    input: CompleteStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      input.id,
      {},
      sharedContext,
    );
    const [updated] = await this.updateStripeLifecycleEvents(
      [
        {
          id: input.id,
          last_error_code: null,
          metadata: {
            ...(lifecycleEvent.metadata as Record<string, unknown>),
            ...input.metadata,
          },
          next_retry_at: null,
          order_id: input.orderId ?? lifecycleEvent.order_id,
          processed_at: new Date(),
          provider_object_status: input.providerObjectStatus,
          status: input.status,
        },
      ],
      sharedContext,
    );
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Stripe lifecycle completion state was not persisted.",
      );
    }
    return updated;
  }

  @InjectManager()
  async completeStripeLifecycleEvent(
    input: CompleteStripeLifecycleEventInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    return this.completeStripeLifecycleEvent_(input, sharedContext);
  }

  @InjectTransactionManager()
  protected async markStripeLifecycleEventFailed_(
    id: string,
    errorCode: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    if (!/^[a-z0-9_]{3,64}$/.test(errorCode)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Stripe lifecycle error code is invalid.",
      );
    }
    const lifecycleEvent = await this.retrieveStripeLifecycleEvent(
      id,
      {},
      sharedContext,
    );
    if (
      lifecycleEvent.status === "processed" ||
      lifecycleEvent.status === "ignored"
    ) {
      return lifecycleEvent;
    }

    const attemptCount = Math.max(1, lifecycleEvent.attempt_count);
    const [updated] = await this.updateStripeLifecycleEvents(
      [
        {
          id,
          last_error_code: errorCode,
          next_retry_at: new Date(Date.now() + retryDelayMs(attemptCount)),
          status: "failed",
        },
      ],
      sharedContext,
    );
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Stripe lifecycle failure state was not persisted.",
      );
    }
    return updated;
  }

  @InjectManager()
  async markStripeLifecycleEventFailed(
    id: string,
    errorCode: string,
    @MedusaContext() sharedContext: Context<EntityManager> = {},
  ) {
    return this.markStripeLifecycleEventFailed_(
      id,
      errorCode,
      sharedContext,
    );
  }
}

export default PaymentLifecycleModuleService;
