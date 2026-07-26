"use client";

import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";
import { Badge, Container, Heading, Text } from "@medusajs/ui";

import {
  stripeDashboardPaymentUrl,
  stripePaymentReferencesFromOrder,
} from "../../lib/stripe/order-sync";

const formatAmount = (
  amount: number | null,
  currencyCode: string | null,
): string => {
  if (amount === null || !currencyCode) {
    return "Amount unavailable";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount);
};

const StripeOrderPaymentWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const references = stripePaymentReferencesFromOrder(data);
  if (!references.length) {
    return <></>;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <div>
          <Heading level="h2">Stripe payments</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Medusa remains the order authority. Stripe provides payment
            processing details.
          </Text>
        </div>
        <Badge color="blue" size="2xsmall">
          Linked
        </Badge>
      </div>
      <div className="grid gap-3 px-6 py-4">
        {references.map((reference) => (
          <div
            key={reference.paymentIntentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ui-border-base p-3"
          >
            <div>
              <Text size="small" weight="plus">
                {formatAmount(reference.amount, reference.currencyCode)}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {reference.status ?? "Status pending"}
                {reference.livemode ? " · Live mode" : " · Test mode"}
              </Text>
            </div>
            <a
              href={stripeDashboardPaymentUrl(reference)}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-ui-border-strong px-2.5 py-1.5 text-ui-fg-interactive hover:bg-ui-bg-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
            >
              <Text size="small" weight="plus">
                Open in Stripe
              </Text>
            </a>
          </div>
        ))}
        <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus">
            Issue refunds from this order
          </Text>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            Use Medusa&apos;s payment actions so the order ledger, Stripe
            refund, and tax evidence stay together. Open Stripe for
            investigation only; do not refund from the Stripe Dashboard.
          </Text>
        </div>
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  id: "remorseless:order-stripe-payment",
  zone: "order.details.after",
});

export default StripeOrderPaymentWidget;
