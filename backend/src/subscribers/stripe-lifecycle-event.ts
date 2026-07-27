import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework";
import type {
  ILockingModule,
  Logger,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import Stripe from "stripe";

import { STRIPE_API_KEY } from "../lib/constants";
import { processStripeLifecycleEvent } from "../lib/payment-lifecycle/process-stripe-event";
import {
  PAYMENT_LIFECYCLE_MODULE,
  STRIPE_LIFECYCLE_RECEIVED_EVENT,
  stripeLifecycleLockKey,
} from "../modules/payment-lifecycle/constants";
import type PaymentLifecycleModuleService from "../modules/payment-lifecycle/service";
import type TaxControlModuleService from "../modules/tax-control/service";

type StripeLifecycleEventData = {
  id: string;
};

export default async function stripeLifecycleEventHandler({
  event: { data },
  container,
}: SubscriberArgs<StripeLifecycleEventData>): Promise<void> {
  if (!STRIPE_API_KEY) {
    throw new Error(
      "Stripe lifecycle processing requires Stripe configuration.",
    );
  }

  const lifecycleService =
    container.resolve<PaymentLifecycleModuleService>(
      PAYMENT_LIFECYCLE_MODULE,
    );
  const taxControlService =
    container.resolve<TaxControlModuleService>("tax_control");
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  const logger = container.resolve<Logger>("logger");
  const client = new Stripe(STRIPE_API_KEY, {
    appInfo: {
      name: "remorseless-records-medusa",
      version: "1.0.0",
    },
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
  const result = await locking.execute(
    stripeLifecycleLockKey(data.id),
    () =>
      processStripeLifecycleEvent({
        client,
        eventId: data.id,
        lifecycleService,
        taxControlService,
      }),
    { timeout: 10 },
  );

  const message = JSON.stringify({
    evidence_found: result.evidenceFound,
    lifecycle_event_id: data.id,
    status: result.status,
  });
  if (result.status === "ignored") {
    logger.warn(`Stripe lifecycle event needs review: ${message}`);
    return;
  }
  logger.info(`Stripe lifecycle event reconciled: ${message}`);
}

export const config: SubscriberConfig = {
  event: STRIPE_LIFECYCLE_RECEIVED_EVENT,
};
