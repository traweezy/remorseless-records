import Link from "next/link"
import type { Metadata } from "next"

import { runtimeEnv } from "@/config/env"
import { cn } from "@/lib/ui/cn"
import { notFound, redirect } from "next/navigation"

export const metadata: Metadata = {
  title: "Order confirmed",
}

type OrderSummaryResponse = {
  order: {
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
    items: {
      id: string
      title: string
      quantity: number
      unit_price: number
      total: number
    }[]
  }
  cart_id: string
}

type ConfirmedPageProps = {
  searchParams: { session_id?: string }
}

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  })

const ConfirmedPage = async ({ searchParams }: ConfirmedPageProps) => {
  const sessionId = searchParams.session_id

  if (!sessionId) {
    redirect("/cart")
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
  const formatMoney = currencyFormatter(order.currency_code)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16">
      <div className="rounded-lg border border-border bg-surface/90 p-8 shadow-elegant">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-accent">
            Order Confirmed
          </h1>
          <p className="text-muted-foreground">
            Thank you for supporting the underground. Your receipt has been
            emailed and we&apos;re already spinning the presses.
          </p>
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
        </div>
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
                      {formatMoney.format(item.total / 100)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney.format(item.unit_price / 100)} each
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/70 p-6">
            <h2 className="font-headline text-xl text-foreground">Totals</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <SummaryRow label="Subtotal" value={formatMoney.format(order.subtotal / 100)} />
              <SummaryRow label="Shipping" value={formatMoney.format(order.shipping_total / 100)} />
              <SummaryRow label="Tax" value={formatMoney.format(order.tax_total / 100)} />
              {order.discount_total > 0 ? (
                <SummaryRow
                  label="Discounts"
                  value={`- ${formatMoney.format(order.discount_total / 100)}`}
                />
              ) : null}
              <SummaryRow
                label="Total"
                value={formatMoney.format(order.total / 100)}
                highlight
              />
            </dl>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4">
        <Link
          href="/"
          className={cn(
            "inline-flex items-center rounded-full border border-accent px-6 py-2 text-sm uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
          )}
        >
          Continue Crate Digging
        </Link>
        <p className="text-xs text-muted-foreground">
          Need help? Email us at support@remorselessrecords.com
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
