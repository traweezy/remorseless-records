import type Stripe from "stripe";

import { reconcileTaxQuoteEvidence } from "../tax-control/evidence-reconciliation";
import type PaymentLifecycleModuleService from "../../modules/payment-lifecycle/service";
import type TaxControlModuleService from "../../modules/tax-control/service";

type UnknownRecord = Record<string, unknown>;

export type ProcessStripeLifecycleResult = {
  evidenceFound: boolean;
  status: "ignored" | "processed";
};

class StripeLifecycleIntegrityError extends Error {
  constructor() {
    super("Stripe lifecycle object integrity check failed.");
    this.name = "StripeLifecycleIntegrityError";
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const expandableId = (value: unknown, pattern: RegExp): string | null => {
  const candidate =
    typeof value === "string" ? value : asRecord(value)?.id;
  return typeof candidate === "string" && pattern.test(candidate)
    ? candidate
    : null;
};

const paymentIntentIdFrom = (value: unknown): string | null =>
  expandableId(value, /^pi_[A-Za-z0-9]+$/);

const currentProviderObject = async ({
  client,
  eventType,
  objectId,
}: {
  client: Stripe;
  eventType: string;
  objectId: string;
}): Promise<UnknownRecord> => {
  const object = eventType.startsWith("refund.")
    ? await client.refunds.retrieve(objectId)
    : await client.disputes.retrieve(objectId);
  return object as unknown as UnknownRecord;
};

const orderIdFrom = (intent: Stripe.PaymentIntent): string | null => {
  const orderId = text(intent.metadata.medusa_order_id);
  return orderId && /^order_[A-Za-z0-9]+$/.test(orderId) ? orderId : null;
};

const assertCurrentObjectMatches = ({
  current,
  lifecycleEvent,
}: {
  current: UnknownRecord;
  lifecycleEvent: {
    amount_minor: number | null;
    currency_code: string | null;
    livemode: boolean;
    object_id: string;
    payment_intent_id: string | null;
  };
}): string | null => {
  const currentId = text(current.id);
  const currentPaymentIntentId = paymentIntentIdFrom(current.payment_intent);
  const currentAmount = Number(current.amount);
  const currentCurrency = text(current.currency)?.toLowerCase() ?? null;
  const currentLivemodeMismatch =
    current.livemode !== undefined &&
    (typeof current.livemode !== "boolean" ||
      current.livemode !== lifecycleEvent.livemode);
  const immutableMismatch =
    currentId !== lifecycleEvent.object_id ||
    currentLivemodeMismatch ||
    (lifecycleEvent.payment_intent_id !== null &&
      currentPaymentIntentId !== lifecycleEvent.payment_intent_id) ||
    (lifecycleEvent.amount_minor !== null &&
      currentAmount !== lifecycleEvent.amount_minor) ||
    (lifecycleEvent.currency_code !== null &&
      currentCurrency !== lifecycleEvent.currency_code);
  if (immutableMismatch) {
    throw new StripeLifecycleIntegrityError();
  }
  return currentPaymentIntentId;
};

const processingErrorCode = (error: unknown): string => {
  if (error instanceof StripeLifecycleIntegrityError) {
    return "stripe_object_integrity_mismatch";
  }
  if (
    error instanceof Error &&
    (error.name.startsWith("Stripe") ||
      asRecord(error)?.type === "StripeError")
  ) {
    return "stripe_api_error";
  }
  return "lifecycle_processing_error";
};

export const processStripeLifecycleEvent = async ({
  client,
  eventId,
  lifecycleService,
  taxControlService,
}: {
  client: Stripe;
  eventId: string;
  lifecycleService: PaymentLifecycleModuleService;
  taxControlService: TaxControlModuleService;
}): Promise<ProcessStripeLifecycleResult> => {
  try {
    const lifecycleEvent =
      await lifecycleService.markStripeLifecycleEventProcessing(eventId);
    if (
      lifecycleEvent.status === "processed" ||
      lifecycleEvent.status === "ignored"
    ) {
      return {
        evidenceFound:
          asRecord(lifecycleEvent.metadata)?.tax_evidence_found === true,
        status: lifecycleEvent.status,
      };
    }

    const current = await currentProviderObject({
      client,
      eventType: lifecycleEvent.event_type,
      objectId: lifecycleEvent.object_id,
    });
    const paymentIntentId = assertCurrentObjectMatches({
      current,
      lifecycleEvent,
    });
    const providerObjectStatus = text(current.status);
    if (!paymentIntentId) {
      await lifecycleService.completeStripeLifecycleEvent({
        id: eventId,
        metadata: {
          ignored_reason: "payment_intent_missing",
          tax_evidence_found: false,
        },
        providerObjectStatus,
        status: "ignored",
      });
      return { evidenceFound: false, status: "ignored" };
    }

    const intent = await client.paymentIntents.retrieve(paymentIntentId);
    const orderId = orderIdFrom(intent);
    const reconciliation = await reconcileTaxQuoteEvidence({
      client,
      ...(orderId ? { orderId } : {}),
      paymentIntentId,
      service: taxControlService,
    });
    const status = reconciliation.evidenceFound ? "processed" : "ignored";
    await lifecycleService.completeStripeLifecycleEvent({
      id: eventId,
      metadata: {
        tax_association_status: reconciliation.associationStatus,
        tax_evidence_found: reconciliation.evidenceFound,
        tax_evidence_status: reconciliation.status,
        ...(!reconciliation.evidenceFound
          ? { ignored_reason: "tax_evidence_not_found" }
          : {}),
      },
      ...(orderId ? { orderId } : {}),
      providerObjectStatus,
      status,
    });
    return {
      evidenceFound: reconciliation.evidenceFound,
      status,
    };
  } catch (error) {
    const errorCode = processingErrorCode(error);
    await lifecycleService
      .markStripeLifecycleEventFailed(eventId, errorCode)
      .catch(() => undefined);
    throw new Error(
      `Stripe lifecycle event processing failed (${errorCode}).`,
    );
  }
};
