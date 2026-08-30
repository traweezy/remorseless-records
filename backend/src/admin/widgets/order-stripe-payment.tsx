"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"

import {
  stripeDashboardPaymentUrl,
  stripePaymentReferencesFromOrder,
} from "../../lib/stripe/order-sync"
import { operationsAppRoutePaths } from "../features/operations/operations-routes"

const formatAmount = (
  amount: number | null,
  currencyCode: string | null
): string => {
  if (amount === null || !currencyCode) {
    return "Amount unavailable"
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount)
}

const StripeOrderPaymentWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const references = stripePaymentReferencesFromOrder(data)
  if (!references.length) {
    return null
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
            <Button asChild size="small" variant="secondary">
              <a
                href={stripeDashboardPaymentUrl(reference)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Stripe
              </a>
            </Button>
          </div>
        ))}
        <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <Text size="small" weight="plus">
                Choose the order workflow before refunding
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                If an item is coming back, create a return or claim and record
                the inventory outcome first. For a payment-only correction, use
                this order&apos;s payment-row Refund action.
              </Text>
            </div>
            <Button asChild size="small" variant="secondary">
              <a href={operationsAppRoutePaths.refunds}>
                Refund guide and audit
              </a>
            </Button>
          </div>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            Always issue the refund in Medusa so the order ledger, Stripe, and
            tax evidence stay together. Open Stripe for investigation only.
          </Text>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  id: "remorseless:order-stripe-payment",
  zone: "order.details.after",
})

export default StripeOrderPaymentWidget
