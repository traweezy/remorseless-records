import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import Stripe from "stripe";

import { STRIPE_API_KEY } from "@/lib/constants";
import {
  orderUsesStripe,
  stripePaymentReferencesFromOrder,
  syncStripeOrderReferences,
  type StripeOrderSyncClient,
} from "@/lib/stripe/order-sync";

type OrderPlacedData = {
  id: string;
};

type QueryGraph = {
  graph: (input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
    pagination: { take: number };
  }) => Promise<{ data: unknown[] }>;
};

type Logger = {
  info: (message: string) => void;
};

export default async function stripeOrderSyncHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>): Promise<void> {
  if (!STRIPE_API_KEY) {
    return;
  }

  const query = container.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  const result = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "total",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.amount",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.data",
      "payment_collections.payments.captured_at",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.amount",
      "payment_collections.payment_sessions.currency_code",
      "payment_collections.payment_sessions.data",
      "payment_collections.payment_sessions.status",
    ],
    filters: { id: data.id },
    pagination: { take: 1 },
  });
  const order = result.data[0] as Record<string, unknown> | undefined;
  if (!order) {
    throw new Error("Stripe order sync could not retrieve the Medusa order");
  }

  const orderNumber = String(order.display_id ?? "").trim();
  if (!orderNumber) {
    throw new Error("Stripe order sync requires an order number");
  }

  const references = stripePaymentReferencesFromOrder(order);
  if (!references.length) {
    if (orderUsesStripe(order) && Number(order.total) > 0) {
      throw new Error(
        "Stripe order sync could not find the order PaymentIntent",
      );
    }
    return;
  }

  const stripe = new Stripe(STRIPE_API_KEY, {
    appInfo: {
      name: "remorseless-records-medusa",
      version: "1.0.0",
    },
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
  const synchronizedCount = await syncStripeOrderReferences({
    client: stripe as StripeOrderSyncClient,
    orderId: data.id,
    orderNumber,
    references,
  });

  logger.info(
    `[stripe-order-sync] synchronized ${synchronizedCount} payment reference(s)`,
  );
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
