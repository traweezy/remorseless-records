import type Stripe from "stripe"

import { reconcileTaxQuoteEvidence } from "../tax-control/evidence-reconciliation"
import {
  createStripeEvidenceReader,
  StripeEvidenceClientError,
  type StripeEvidenceRetryEvent,
  type StripeLifecycleObjectSnapshot,
} from "../tax-control/stripe-evidence-client"
import type PaymentLifecycleModuleService from "../../modules/payment-lifecycle/service"
import type TaxControlModuleService from "../../modules/tax-control/service"
import { stripeLifecycleRecordFrom } from "./contracts"

type UnknownRecord = Record<string, unknown>

export type ProcessStripeLifecycleResult = {
  evidenceFound: boolean
  status: "ignored" | "processed"
}

class StripeLifecycleIntegrityError extends Error {
  constructor() {
    super("Stripe lifecycle object integrity check failed.")
    this.name = "StripeLifecycleIntegrityError"
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const assertCurrentObjectMatches = ({
  current,
  lifecycleEvent,
}: {
  current: StripeLifecycleObjectSnapshot
  lifecycleEvent: {
    amount_minor: number | null
    currency_code: string | null
    livemode: boolean
    object_id: string
    payment_intent_id: string | null
  }
}): string | null => {
  const currentLivemodeMismatch =
    current.livemode !== null && current.livemode !== lifecycleEvent.livemode
  const immutableMismatch =
    current.id !== lifecycleEvent.object_id ||
    currentLivemodeMismatch ||
    (lifecycleEvent.payment_intent_id !== null &&
      current.paymentIntentId !== lifecycleEvent.payment_intent_id) ||
    (lifecycleEvent.amount_minor !== null &&
      current.amountMinor !== lifecycleEvent.amount_minor) ||
    (lifecycleEvent.currency_code !== null &&
      current.currencyCode !== lifecycleEvent.currency_code)
  if (immutableMismatch) {
    throw new StripeLifecycleIntegrityError()
  }
  return current.paymentIntentId
}

const processingErrorCode = (error: unknown): string => {
  if (error instanceof StripeLifecycleIntegrityError) {
    return "stripe_object_integrity_mismatch"
  }
  if (error instanceof StripeEvidenceClientError) {
    return error.code === "invalid_request" || error.code === "invalid_response"
      ? "stripe_object_integrity_mismatch"
      : "stripe_api_error"
  }
  if (
    error instanceof Error &&
    (error.name.startsWith("Stripe") || asRecord(error)?.type === "StripeError")
  ) {
    return "stripe_api_error"
  }
  return "lifecycle_processing_error"
}

export const processStripeLifecycleEvent = async ({
  client,
  eventId,
  lifecycleService,
  onRetry,
  taxControlService,
  timeoutMs = 8_000,
}: {
  client: Stripe
  eventId: string
  lifecycleService: PaymentLifecycleModuleService
  onRetry?: (event: StripeEvidenceRetryEvent) => void
  taxControlService: TaxControlModuleService
  timeoutMs?: number
}): Promise<ProcessStripeLifecycleResult> => {
  try {
    const lifecycleEvent = stripeLifecycleRecordFrom(
      await lifecycleService.markStripeLifecycleEventProcessing(eventId)
    )
    if (
      lifecycleEvent.status === "processed" ||
      lifecycleEvent.status === "ignored"
    ) {
      return {
        evidenceFound: lifecycleEvent.metadata.tax_evidence_found === true,
        status: lifecycleEvent.status,
      }
    }

    const reader = createStripeEvidenceReader({
      client,
      ...(onRetry ? { onRetry } : {}),
      timeoutMs,
    })
    const current = await reader.readLifecycleObject({
      eventType: lifecycleEvent.event_type,
      objectId: lifecycleEvent.object_id,
    })
    const paymentIntentId = assertCurrentObjectMatches({
      current,
      lifecycleEvent,
    })
    const providerObjectStatus = current.status
    if (!paymentIntentId) {
      await lifecycleService.completeStripeLifecycleEvent({
        id: eventId,
        metadata: {
          ignored_reason: "payment_intent_missing",
          tax_evidence_found: false,
        },
        providerObjectStatus,
        status: "ignored",
      })
      return { evidenceFound: false, status: "ignored" }
    }

    const intent = await reader.readIntent(paymentIntentId)
    const orderId = intent.orderId
    const reconciliation = await reconcileTaxQuoteEvidence({
      client,
      ...(orderId ? { orderId } : {}),
      paymentIntentId,
      reader,
      service: taxControlService,
    })
    const status = reconciliation.evidenceFound ? "processed" : "ignored"
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
    })
    return {
      evidenceFound: reconciliation.evidenceFound,
      status,
    }
  } catch (error) {
    const errorCode = processingErrorCode(error)
    await lifecycleService
      .markStripeLifecycleEventFailed(eventId, errorCode)
      .catch(() => undefined)
    throw new Error(`Stripe lifecycle event processing failed (${errorCode}).`)
  }
}
