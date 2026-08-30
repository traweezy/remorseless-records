import type {
  IPaymentModuleService,
  ILockingModule,
  Logger,
} from "@medusajs/framework/types";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import Stripe from "stripe";

import { STRIPE_API_KEY } from "../lib/constants";
import { reconcileTaxQuoteEvidence } from "../lib/tax-control/evidence-reconciliation";
import { taxEvidenceLockKey } from "../modules/tax-control/constants";
import type TaxControlModuleService from "../modules/tax-control/service";

type PaymentEventData = {
  id: string;
};

const paymentIntentIdFrom = (
  data: Record<string, unknown> | undefined,
): string | null => {
  const id = data?.id;
  return typeof id === "string" && /^pi_[A-Za-z0-9]+$/.test(id) ? id : null;
};

export default async function paymentTaxEvidenceHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentEventData>): Promise<void> {
  if (!STRIPE_API_KEY) {
    return;
  }

  const paymentService = container.resolve<IPaymentModuleService>(
    Modules.PAYMENT,
  );
  const payment = await paymentService.retrievePayment(data.id);
  if (payment.provider_id !== "pp_stripe_stripe") {
    return;
  }
  const paymentIntentId = paymentIntentIdFrom(payment.data);
  if (!paymentIntentId) {
    throw new Error(
      "Stripe tax evidence reconciliation requires a PaymentIntent ID.",
    );
  }

  const service = container.resolve<TaxControlModuleService>("tax_control");
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  const logger = container.resolve<Logger>("logger");
  const client = new Stripe(STRIPE_API_KEY, {
    appInfo: {
      name: "remorseless-records-medusa",
      version: "1.0.0",
    },
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 10_000,
  });
  const result = await locking.execute(
    taxEvidenceLockKey(paymentIntentId),
    () =>
      reconcileTaxQuoteEvidence({
        client,
        onRetry: (event) => {
          logger.warn(
            `[tax-evidence] Stripe safe-read retry scheduled (${event.operation}, ${event.reason}, attempt ${event.attempt}/${event.totalAttempts}).`,
          );
        },
        paymentIntentId,
        service,
      }),
    { timeout: 5 },
  );

  if (result.evidenceFound) {
    logger.info(
      `[tax-evidence] reconciliation completed (${result.status}).`,
    );
  }
}

export const config: SubscriberConfig = {
  event: ["payment.captured", "payment.refunded"],
};
