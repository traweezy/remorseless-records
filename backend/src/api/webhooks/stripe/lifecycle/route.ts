import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type { IEventBusModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import Stripe from "stripe";

import { STRIPE_LIFECYCLE_WEBHOOK_SECRET } from "../../../../lib/constants";
import { projectStripeLifecycleEvent } from "../../../../lib/payment-lifecycle/stripe-event";
import {
  PAYMENT_LIFECYCLE_MODULE,
  STRIPE_LIFECYCLE_RECEIVED_EVENT,
} from "../../../../modules/payment-lifecycle/constants";
import type PaymentLifecycleModuleService from "../../../../modules/payment-lifecycle/service";

const signatureHeader = (req: MedusaRequest): string | null => {
  const value = req.headers["stripe-signature"];
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const respond = (
  res: MedusaResponse,
  status: number,
  body: Record<string, unknown>,
): void => {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
};

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  if (!STRIPE_LIFECYCLE_WEBHOOK_SECRET) {
    respond(res, 503, {
      type: "lifecycle_webhook_unavailable",
      message: "The payment lifecycle webhook is not configured.",
    });
    return;
  }

  const signature = signatureHeader(req);
  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : typeof req.rawBody === "string"
      ? Buffer.from(req.rawBody)
      : null;
  if (!signature || !rawBody) {
    respond(res, 400, {
      type: "invalid_webhook",
      message: "The webhook signature or payload is missing.",
    });
    return;
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      rawBody,
      signature,
      STRIPE_LIFECYCLE_WEBHOOK_SECRET,
    );
  } catch {
    respond(res, 400, {
      type: "invalid_webhook",
      message: "The webhook signature or payload is invalid.",
    });
    return;
  }

  let projected: ReturnType<typeof projectStripeLifecycleEvent>;
  try {
    projected = projectStripeLifecycleEvent(event);
  } catch {
    respond(res, 400, {
      type: "invalid_webhook",
      message: "The webhook event is malformed.",
    });
    return;
  }
  if (!projected) {
    respond(res, 200, { received: true, ignored: true });
    return;
  }

  const lifecycleService =
    req.scope.resolve<PaymentLifecycleModuleService>(
      PAYMENT_LIFECYCLE_MODULE,
    );
  const recorded =
    await lifecycleService.recordStripeLifecycleEvent(projected);
  const terminalOrRunning = new Set([
    "ignored",
    "processed",
    "processing",
  ]).has(recorded.lifecycleEvent.status);
  if (!terminalOrRunning) {
    const eventBus = req.scope.resolve<IEventBusModuleService>(
      Modules.EVENT_BUS,
    );
    try {
      await eventBus.emit({
        name: STRIPE_LIFECYCLE_RECEIVED_EVENT,
        data: { id: recorded.lifecycleEvent.id },
      });
    } catch {
      await lifecycleService.markStripeLifecycleEventFailed(
        recorded.lifecycleEvent.id,
        "event_bus_unavailable",
      );
      respond(res, 500, {
        type: "webhook_processing_unavailable",
        message: "The webhook event could not be queued.",
      });
      return;
    }
  }

  respond(res, 200, {
    received: true,
    replayed: recorded.replayed,
  });
};
