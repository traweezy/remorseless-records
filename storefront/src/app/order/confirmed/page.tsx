import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { runtimeEnv } from "@/config/env"
import SmartLink from "@/components/ui/smart-link"
import { cn } from "@/lib/ui/cn"

export const metadata: Metadata = {
  title: "Order confirmed",
}

type OrderSummaryItem = {
  id: string
  title: string
  quantity: number
  unit_price: number
  total: number
}

type OrderSummary = {
  id: string
  display_id: number
  email?: string
  currency_code: string
  total: number
  subtotal: number
  tax_total: number
  discount_total: number
  shipping_total: number
  created_at?: string | Date
  items: OrderSummaryItem[]
}

type CheckoutStatus = "paid" | "failed" | "expired" | "processing"

type OrderSummaryResponse = {
  order: OrderSummary | null
  cart_id: string
  stripe_checkout_status: CheckoutStatus
  stripe_checkout_last_error: string | null
  stripe_checkout_last_error_code: string | null
  stripe_checkout_session_id: string
  stripe_payment_intent_id: string | null
  stripe_last_refund: {
    id: string | null
    amount: number | null
    currency: string | null
    event_id: string | null
  } | null
}

type ConfirmedPageProps = {
  searchParams: Promise<{ session_id?: string }>
}

const createCurrencyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  })

const ConfirmedPage = async ({ searchParams }: ConfirmedPageProps) => {
  const resolvedSearchParams = await searchParams
  const sessionId = resolvedSearchParams.session_id

  if (!sessionId) {
    redirect("/?cart=1")
  }

  const response = await fetch(
    new URL(
      `/store/orders/stripe-session/${encodeURIComponent(sessionId)}`,
      runtimeEnv.medusaBackendUrl
    ).toString(),
    {
      cache: "no-store",
      headers: {
        "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
      },
    }
  )

  if (!response.ok) {
    notFound()
  }

  const data = (await response.json()) as OrderSummaryResponse
  const { order } = data
  const status = data.stripe_checkout_status
  const formatMoney = order ? createCurrencyFormatter(order.currency_code) : null

  const statusConfig = STATUS_DISPLAY[status]
  const errorMessage = data.stripe_checkout_last_error
  const errorCode = data.stripe_checkout_last_error_code

  const refundDisplay =
    data.stripe_last_refund && (order || data.stripe_last_refund.amount != null)
      ? formatRefund(
          data.stripe_last_refund,
          order?.currency_code ?? data.stripe_last_refund.currency ?? "usd"
        )
      : null

  const primaryCta =
    status === "failed" || status === "expired"
      ? { href: "/?cart=1", label: "Return to Cart" }
      : { href: "/", label: "Continue Crate Digging" }

  const supportReference =
    data.stripe_payment_intent_id ?? data.stripe_checkout_session_id

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16">
      <div className="rounded-lg border border-border bg-surface/90 p-8 shadow-elegant">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase tracking-[0.3rem]",
                statusConfig.badgeClass
              )}
            >
              {statusConfig.badgeLabel}
            </span>
          </div>
          <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-accent">
            {statusConfig.heading}
          </h1>
          <p className="text-muted-foreground">{statusConfig.description}</p>
          {order ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm uppercase tracking-[0.15rem] text-muted-foreground">
              <span className="font-semibold text-foreground">
                Order #{order.display_id}
              </span>
              {order.created_at ? (
                <span>
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(order.created_at))}
                </span>
              ) : null}
              {order.email ? <span>{order.email}</span> : null}
            </div>
          ) : null}
        </div>

        {status === "failed" && (errorMessage || errorCode) ? (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-semibold uppercase tracking-[0.25rem]">
              Payment declined
            </p>
            {errorMessage ? (
              <p className="mt-2 text-destructive/90">{errorMessage}</p>
            ) : null}
            {errorCode ? (
              <p className="mt-1 text-xs uppercase tracking-[0.3rem] text-destructive/80">
                Stripe code · {errorCode}
              </p>
            ) : null}
          </div>
        ) : null}

        {status === "processing" ? (
          <div className="mt-6 rounded-lg border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
            <p>
              Your payment cleared but we&apos;re still finalizing the order.
              Refresh in a minute or watch for the confirmation email—we&apos;ll
              drop the receipt as soon as it&apos;s sealed.
            </p>
          </div>
        ) : null}

        {status === "expired" ? (
          <div className="mt-6 rounded-lg border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
            <p>
              The Stripe checkout session expired before payment completed.
              Restart checkout from your cart when you&apos;re ready to try
              again.
            </p>
          </div>
        ) : null}

        {refundDisplay ? (
          <div className="mt-6 rounded-lg border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
            <p className="font-semibold uppercase tracking-[0.25rem] text-foreground">
              Refund in progress
            </p>
            <p className="mt-2">
              Stripe issued a refund for {refundDisplay.amount}. Depending on
              your bank it can take up to 5-10 business days to settle.
            </p>
            {refundDisplay.id ? (
              <p className="mt-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                Refund reference · {refundDisplay.id}
              </p>
            ) : null}
          </div>
        ) : null}

        {order && status === "paid" ? (
          <div className="mt-8 grid gap-6">
            <div className="rounded-xl border border-border/60 bg-background/70 p-6">
              <h2 className="font-headline text-xl text-foreground">Items</h2>
              <ul className="mt-4 space-y-3">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg bg-background/80 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                        Qty {item.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">
                        {formatMoney?.format(item.total / 100)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatMoney?.format(item.unit_price / 100)} each
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 p-6">
              <h2 className="font-headline text-xl text-foreground">Totals</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <SummaryRow
                  label="Subtotal"
                  value={formatMoney?.format(order.subtotal / 100) ?? ""}
                />
                <SummaryRow
                  label="Shipping"
                  value={formatMoney?.format(order.shipping_total / 100) ?? ""}
                />
                <SummaryRow
                  label="Tax"
                  value={formatMoney?.format(order.tax_total / 100) ?? ""}
                />
                {order.discount_total > 0 ? (
                  <SummaryRow
                    label="Discounts"
                    value={`- ${
                      formatMoney?.format(order.discount_total / 100) ?? ""
                    }`}
                  />
                ) : null}
                <SummaryRow
                  label="Total"
                  value={formatMoney?.format(order.total / 100) ?? ""}
                  highlight
                />
              </dl>
            </div>
          </div>
        ) : null}

        {!order && status === "processing" ? (
          <div className="mt-8 rounded-xl border border-border/60 bg-background/70 p-6 text-sm text-muted-foreground">
            <p>
              We&apos;ll email the full receipt—including line items and
              tracking details—as soon as everything is queued for fulfillment.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-4">
        <SmartLink
          href={primaryCta.href}
          nativePrefetch
          className={cn(
            "inline-flex items-center rounded-full border border-accent px-6 py-2 text-sm uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
          )}
        >
          {primaryCta.label}
        </SmartLink>
        <p className="text-xs text-muted-foreground">
          Need help? Email us at support@remorselessrecords.com
          {supportReference ? (
            <>
              {" "}
              with reference{" "}
              <span className="font-mono text-foreground">
                {supportReference}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}

export default ConfirmedPage

type SummaryRowProps = {
  label: string
  value: string
  highlight?: boolean
}

const SummaryRow = ({ label, value, highlight }: SummaryRowProps) => (
  <div className="flex items-center justify-between">
    <dt className="text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "font-semibold text-foreground",
        highlight ? "text-accent" : undefined
      )}
    >
      {value}
    </dd>
  </div>
)

const STATUS_DISPLAY: Record<
  CheckoutStatus,
  { heading: string; description: string; badgeLabel: string; badgeClass: string }
> = {
  paid: {
    heading: "Order Confirmed",
    description:
      "Thank you for supporting the underground. Your receipt has been emailed and we’re already spinning the presses.",
    badgeLabel: "Paid",
    badgeClass:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.25)]",
  },
  processing: {
    heading: "Order Processing",
    description:
      "Payment cleared—we’re finishing the ritual. Hang tight while the order gets sealed and logged.",
    badgeLabel: "Processing",
    badgeClass:
      "border-amber-400/40 bg-amber-400/10 text-amber-200 shadow-[0_0_20px_rgba(250,204,21,0.25)]",
  },
  failed: {
    heading: "Payment Failed",
    description:
      "Stripe couldn’t complete the charge. Nothing left your account—review the error below and try again.",
    badgeLabel: "Failed",
    badgeClass:
      "border-destructive/50 bg-destructive/10 text-destructive shadow-[0_0_20px_rgba(239,68,68,0.25)]",
  },
  expired: {
    heading: "Checkout Expired",
    description:
      "The session timed out before payment was confirmed. Jump back into your cart whenever you’re ready.",
    badgeLabel: "Session Expired",
    badgeClass:
      "border-border/50 bg-border/10 text-muted-foreground shadow-[0_0_20px_rgba(148,163,184,0.2)]",
  },
}

const formatRefund = (
  refund: NonNullable<OrderSummaryResponse["stripe_last_refund"]>,
  fallbackCurrency: string
) => {
  const currency = (refund.currency ?? fallbackCurrency ?? "USD").toUpperCase()
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  })

  return {
    id: refund.id,
    amount:
      refund.amount != null ? formatter.format(refund.amount / 100) : null,
  }
}
