import type Stripe from "stripe";

import {
  stripeLifecycleEventTypes,
  type StripeLifecycleEventType,
} from "../../modules/payment-lifecycle/constants";
import type { RecordStripeLifecycleEventInput } from "../../modules/payment-lifecycle/service";

type UnknownRecord = Record<string, unknown>;

const supportedTypes = new Set<string>(stripeLifecycleEventTypes);
const eventIdPattern = /^evt_[A-Za-z0-9]+$/;
const paymentIntentIdPattern = /^pi_[A-Za-z0-9]+$/;
const chargeIdPattern = /^ch_[A-Za-z0-9]+$/;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const expandableId = (value: unknown, pattern: RegExp): string | null => {
  const candidate =
    typeof value === "string" ? value : asRecord(value)?.id;
  return typeof candidate === "string" && pattern.test(candidate)
    ? candidate
    : null;
};

const nonnegativeInteger = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const currencyCode = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : null;

const providerStatus = (value: unknown): string | null =>
  typeof value === "string" && /^[a-z_]{2,64}$/.test(value)
    ? value
    : null;

const expectedObjectPrefix = (eventType: StripeLifecycleEventType): string =>
  eventType.startsWith("refund.") ? "re_" : "dp_";

export const projectStripeLifecycleEvent = (
  event: Stripe.Event,
): RecordStripeLifecycleEventInput | null => {
  if (!supportedTypes.has(event.type)) {
    return null;
  }
  const eventType = event.type as StripeLifecycleEventType;
  const object = asRecord(event.data.object);
  const providerEventId =
    typeof event.id === "string" && eventIdPattern.test(event.id)
      ? event.id
      : null;
  const objectId =
    typeof object?.id === "string" &&
    object.id.startsWith(expectedObjectPrefix(eventType))
      ? object.id
      : null;
  if (
    !object ||
    !providerEventId ||
    !objectId ||
    !Number.isSafeInteger(event.created) ||
    event.created < 0
  ) {
    throw new Error("Stripe lifecycle event identity is invalid.");
  }

  return {
    amountMinor: nonnegativeInteger(object.amount),
    chargeId: expandableId(object.charge, chargeIdPattern),
    currencyCode: currencyCode(object.currency),
    eventCreatedAt: new Date(event.created * 1_000),
    eventType,
    livemode: event.livemode === true,
    objectId,
    paymentIntentId: expandableId(
      object.payment_intent,
      paymentIntentIdPattern,
    ),
    providerEventId,
    providerObjectStatus: providerStatus(object.status),
  };
};
