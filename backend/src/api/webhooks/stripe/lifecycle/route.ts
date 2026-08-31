import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import Stripe from "stripe"

import {
  STRIPE_LIFECYCLE_WEBHOOK_SECRET,
  STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS,
} from "../../../../lib/constants"
import { sendApiProblem } from "../../../../lib/http/correlation"
import { recordOperationalIncident } from "../../../../lib/health/incidents"
import { observeOperation } from "../../../../lib/observability/operation-telemetry"
import { projectStripeLifecycleEvent } from "../../../../lib/payment-lifecycle/stripe-event"
import {
  PAYMENT_LIFECYCLE_MODULE,
  STRIPE_LIFECYCLE_RECEIVED_EVENT,
} from "../../../../modules/payment-lifecycle/constants"
import type PaymentLifecycleModuleService from "../../../../modules/payment-lifecycle/service"

const signatureHeader = (req: MedusaRequest): string | null => {
  const value = req.headers["stripe-signature"]
  if (Array.isArray(value)) {
    return value[0]?.trim() || null
  }
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const respondSuccess = (
  res: MedusaResponse,
  body: Record<string, unknown>
): void => {
  res.setHeader("Cache-Control", "no-store")
  res.status(200).json(body)
}

type WebhookProblemInput = {
  code: string
  detail: string
  status: 400 | 503
  title: string
}

const respondProblem = (
  req: MedusaRequest,
  res: MedusaResponse,
  input: WebhookProblemInput
): void => {
  if (input.status === 503) {
    void recordOperationalIncident("webhook_failure").catch(() => undefined)
  }
  res.setHeader("Cache-Control", "no-store")
  sendApiProblem(req, res, {
    ...input,
    instance: req.path,
  })
}

export const createStripeLifecyclePost =
  (
    webhookSecret: string | undefined,
    previousWebhookSecret?: string | undefined
  ) =>
  async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
    const webhookSecrets = Array.from(
      new Set(
        [webhookSecret, previousWebhookSecret]
          .map((candidate) => candidate?.trim())
          .filter((candidate): candidate is string => Boolean(candidate))
      )
    )
    if (!webhookSecrets.length) {
      respondProblem(req, res, {
        code: "lifecycle_webhook_unavailable",
        title: "Payment lifecycle webhook is unavailable",
        status: 503,
        detail: "The payment lifecycle webhook is not configured.",
      })
      return
    }

    const signature = signatureHeader(req)
    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.rawBody === "string"
        ? Buffer.from(req.rawBody)
        : null
    if (!signature || !rawBody) {
      respondProblem(req, res, {
        code: "invalid_webhook",
        title: "Invalid payment lifecycle webhook",
        status: 400,
        detail: "The webhook signature or payload is missing.",
      })
      return
    }

    let event: Stripe.Event
    const verifiedEvent = webhookSecrets.reduce<Stripe.Event | null>(
      (current, candidate) => {
        if (current) {
          return current
        }
        try {
          return Stripe.webhooks.constructEvent(rawBody, signature, candidate)
        } catch {
          return null
        }
      },
      null
    )
    if (!verifiedEvent) {
      respondProblem(req, res, {
        code: "invalid_webhook",
        title: "Invalid payment lifecycle webhook",
        status: 400,
        detail: "The webhook signature or payload is invalid.",
      })
      return
    }
    event = verifiedEvent

    let projected: ReturnType<typeof projectStripeLifecycleEvent>
    try {
      projected = projectStripeLifecycleEvent(event)
    } catch {
      respondProblem(req, res, {
        code: "invalid_webhook",
        title: "Invalid payment lifecycle webhook",
        status: 400,
        detail: "The webhook event is malformed.",
      })
      return
    }
    if (!projected) {
      respondSuccess(res, { received: true, ignored: true })
      return
    }

    try {
      const lifecycleService = req.scope.resolve<PaymentLifecycleModuleService>(
        PAYMENT_LIFECYCLE_MODULE
      )
      const recorded =
        await lifecycleService.recordStripeLifecycleEvent(projected)
      const terminalOrRunning = new Set([
        "ignored",
        "processed",
        "processing",
      ]).has(recorded.lifecycleEvent.status)
      if (!terminalOrRunning) {
        try {
          const eventBus = req.scope.resolve<IEventBusModuleService>(
            Modules.EVENT_BUS
          )
          await observeOperation(
            { domain: "queue", operation: "publish" },
            () =>
              eventBus.emit({
                name: STRIPE_LIFECYCLE_RECEIVED_EVENT,
                data: { id: recorded.lifecycleEvent.id },
              })
          )
        } catch {
          try {
            await lifecycleService.markStripeLifecycleEventFailed(
              recorded.lifecycleEvent.id,
              "event_bus_unavailable"
            )
          } catch {
            // Stripe will retry the non-2xx response; do not mask it.
          }
          respondProblem(req, res, {
            code: "webhook_processing_unavailable",
            title: "Payment lifecycle processing is unavailable",
            status: 503,
            detail: "The webhook event could not be queued.",
          })
          return
        }
      }

      respondSuccess(res, {
        received: true,
        replayed: recorded.replayed,
      })
    } catch {
      respondProblem(req, res, {
        code: "webhook_processing_unavailable",
        title: "Payment lifecycle processing is unavailable",
        status: 503,
        detail: "The webhook event could not be recorded. Try again shortly.",
      })
    }
  }

export const POST = createStripeLifecyclePost(
  STRIPE_LIFECYCLE_WEBHOOK_SECRET,
  STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS
)
