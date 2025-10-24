import Link from "next/link"

import CartItemsList from "@/components/cart/cart-items-list"
import { getCart } from "@/lib/cart"
import { formatAmount } from "@/lib/money"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"
import { cn } from "@/lib/ui/cn"

const CartPage = async () => {
  const cart = await getCart()

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
          href="/products"
          className="mt-8 inline-flex min-h-[48px] items-center rounded-full border border-accent px-8 text-sm font-semibold uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
        >
          Browse Products
        </Link>
      </div>
    )
  }

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

          <CartItemsList cart={cart} />
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
              value={formatAmount(cart.currency_code, Number(cart.subtotal ?? 0))}
            />
            <SummaryRow
              label="Shipping"
              value={formatAmount(cart.currency_code, Number(cart.shipping_total ?? 0))}
            />
            <SummaryRow
              label="Tax"
              value={formatAmount(cart.currency_code, Number(cart.tax_total ?? 0))}
            />
            <SummaryRow
              label="Total"
              value={formatAmount(cart.currency_code, Number(cart.total ?? 0))}
              highlight
            />
          </dl>
          <form
            action={async () => {
              "use server"
              await startStripeCheckout(cart.id)
            }}
          >
            <button
              type="submit"
              className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-accent px-8 py-3 text-base font-semibold uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
            >
              Proceed to Checkout
            </button>
          </form>
          <Link
            href="/products"
            className="inline-flex w-full items-center justify-center rounded-full border border-border/70 px-8 py-3 text-base font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            Continue Shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}

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
        "text-base font-semibold text-foreground",
        highlight && "text-accent"
      )}
    >
      {value}
    </dd>
  </div>
)

export default CartPage
