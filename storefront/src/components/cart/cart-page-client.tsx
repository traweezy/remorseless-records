"use client"

import { useCallback, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"

import CartItemsList from "@/components/cart/cart-items-list"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"
import { useCartQuery } from "@/lib/query/cart"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"

const SummaryRow = ({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) => (
  <div className="flex items-center justify-between">
    <dt className="text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "text-base font-semibold text-foreground",
        highlight && "text-accent"
      )}
    >
      {value}
    </dd>
  </div>
)

const CartPageClient = () => {
  const { data: cart } = useCartQuery()
  const [isCheckingOut, startCheckoutTransition] = useTransition()
  const router = useRouter()

  const prefetchFull = useCallback(
    (href: string) => {
      void router.prefetch(href, { kind: PrefetchKind.FULL })
    },
    [router]
  )

  if (!cart || !cart.items?.length) {
    return (
      <div className="container px-4 py-24 text-center">
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-accent">
          Cart is Empty
        </h1>
        <p className="mx-auto mt-6 max-w-lg text-lg text-muted-foreground">
          No items in your ritual stack yet. Explore the catalog and add some sonic brutality.
        </p>
        <Link
          href="/catalog"
          prefetch
          data-prefetch="true"
          onPointerEnter={() => prefetchFull("/catalog")}
          onFocus={() => prefetchFull("/catalog")}
          className="mt-8 inline-flex min-h-[48px] items-center rounded-full border border-accent px-8 text-sm font-semibold uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
        >
          Browse Products
        </Link>
      </div>
    )
  }

  const currencyCode = cart.currency_code ?? "usd"

  return (
    <div className="container px-4 py-16 lg:py-24">
      <div className="grid gap-12 lg:grid-cols-[1.6fr_1fr]">
        <section className="space-y-8">
          <header className="space-y-2">
            <h1 className="font-display text-4xl uppercase tracking-[0.3rem] text-foreground">
              Cart
            </h1>
            <p className="text-base text-muted-foreground">
              Review the damage before we route you to Stripe’s kill switch.
            </p>
          </header>

          <CartItemsList />
        </section>

        <aside className="flex h-full flex-col gap-6 rounded-2xl border border-border/60 bg-background/80 p-6 shadow-card">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Summary</h2>
            <p className="text-sm text-muted-foreground">
              Taxes and shipping calculated at checkout.
            </p>
          </div>
          <dl className="space-y-3 text-sm">
            <SummaryRow
              label="Subtotal"
              value={formatAmount(currencyCode, Number(cart.subtotal ?? 0))}
            />
            <SummaryRow
              label="Shipping"
              value={formatAmount(currencyCode, Number(cart.shipping_total ?? 0))}
            />
            <SummaryRow
              label="Tax"
              value={formatAmount(currencyCode, Number(cart.tax_total ?? 0))}
            />
            <SummaryRow
              label="Total"
              value={formatAmount(currencyCode, Number(cart.total ?? 0))}
              highlight
            />
          </dl>
          <button
            type="button"
            className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-accent px-8 py-3 text-base font-semibold uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCheckingOut}
            onClick={() => {
              const cartId = cart.id
              if (!cartId) {
                return
              }
              startCheckoutTransition(async () => {
                await startStripeCheckout(cartId)
              })
            }}
          >
            {isCheckingOut ? "Preparing checkout…" : "Proceed to Checkout"}
          </button>
          <Link
            href="/catalog"
            prefetch
            data-prefetch="true"
            onPointerEnter={() => prefetchFull("/catalog")}
            onFocus={() => prefetchFull("/catalog")}
            className="inline-flex w-full items-center justify-center rounded-full border border-border/70 px-8 py-3 text-base font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            Continue Shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}

export default CartPageClient
