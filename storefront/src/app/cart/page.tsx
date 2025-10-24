import Link from "next/link"

import CartDrawer from "@/components/cart-drawer"
import { getCart } from "@/lib/cart"
import { formatAmount } from "@/lib/money"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"
import { cn } from "@/lib/ui/cn"

const CartPage = async () => {
  const cart = await getCart()

  if (!cart || !cart.items?.length) {
    return (
      <div className="px-4 py-16">
        <h1 className="font-display text-5xl uppercase tracking-[0.4rem] text-accent">
          Cart is Empty
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          No items in your ritual stack yet. Explore the catalog and add some sonic brutality.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex items-center rounded-full border border-accent px-6 py-2 text-sm uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
        >
          Browse products
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-12 px-4 py-16 lg:grid-cols-[2fr_1fr]">
      <section className="space-y-6">
        <header className="border-b border-border/60 pb-4">
          <h1 className="font-display text-4xl uppercase tracking-[0.35rem] text-foreground">
            Cart
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review the damage before we route you to Stripe’s kill switch.
          </p>
        </header>
        <CartDrawer cart={cart} />
      </section>

      <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-border/60 bg-surface/80 p-6 shadow-elegant">
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
          Summary
        </h2>
        <dl className="space-y-2 text-sm">
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
            className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-accent px-6 py-3 text-xs uppercase tracking-[0.35rem] text-accent transition hover:bg-accent hover:text-background"
          >
            Proceed to checkout
          </button>
        </form>
      </aside>
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
        "font-semibold text-foreground",
        highlight ? "text-accent" : undefined
      )}
    >
      {value}
    </dd>
  </div>
)

export default CartPage
