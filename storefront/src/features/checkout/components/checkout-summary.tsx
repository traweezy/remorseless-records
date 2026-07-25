import { ChevronDown, Lock } from "lucide-react"
import Image from "next/image"
import { memo, useId } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import SmartLink from "@/components/ui/smart-link"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"
import { formatAmount } from "@/lib/money"
import { cn } from "@/lib/ui/cn"

type CheckoutSummaryProps = {
  checkout: CheckoutProjection
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
}

const SummaryRow = ({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string
  emphasized?: boolean
}) => (
  <div
    className={
      emphasized
        ? "flex items-center justify-between border-t border-border/60 pt-4 text-base font-semibold text-foreground"
        : "flex items-center justify-between text-sm"
    }
  >
    <dt className={emphasized ? undefined : "text-muted-foreground"}>
      {label}
    </dt>
    <dd className="font-semibold text-foreground">{value}</dd>
  </div>
)

export const CheckoutSummary = memo<CheckoutSummaryProps>(
  ({ checkout, expanded = true, onExpandedChange, className }) => {
    const { items, totals } = checkout.cart
    const detailsId = useId()
    const format = (amount: number): string =>
      formatAmount(totals.currencyCode, amount)

    return (
      <Card
        as="aside"
        variant="panel"
        aria-label="Order summary"
        className={cn("overflow-hidden lg:sticky lg:top-24", className)}
      >
        <div className="flex items-center justify-between gap-3 p-5">
          <div>
            <p className="font-headline text-base uppercase tracking-[0.28rem] text-foreground">
              Order summary
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground lg:hidden">
              {format(totals.total)}
            </p>
          </div>
          {onExpandedChange ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={
                expanded ? "Hide order summary" : "Show order summary"
              }
              onClick={() => onExpandedChange(!expanded)}
            >
              <ChevronDown
                className={`h-5 w-5 transition-transform motion-reduce:transition-none ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </Button>
          ) : null}
        </div>

        <div id={detailsId} className={expanded ? "block" : "hidden lg:block"}>
          <div className="space-y-4 border-t border-border/60 px-5 py-5">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {item.thumbnail ? (
                    <Image
                      src={item.thumbnail}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : null}
                  <span className="absolute right-1 top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-background/90 px-1 text-[10px] font-semibold text-foreground">
                    {item.quantity}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-foreground">
                    {item.productTitle}
                  </p>
                  {item.variantTitle ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.variantTitle}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-sm font-semibold text-foreground">
                  {format(item.subtotal)}
                </p>
              </div>
            ))}
          </div>

          <dl className="space-y-3 border-t border-border/60 px-5 py-5">
            <SummaryRow label="Subtotal" value={format(totals.subtotal)} />
            {totals.discountTotal > 0 ? (
              <SummaryRow
                label="Discount"
                value={`−${format(totals.discountTotal)}`}
              />
            ) : null}
            <SummaryRow
              label="Shipping"
              value={
                checkout.cart.shippingMethod
                  ? format(totals.shippingTotal)
                  : "Calculated next"
              }
            />
            <SummaryRow
              label="Tax"
              value={
                checkout.cart.shippingMethod
                  ? format(totals.taxTotal)
                  : "Calculated next"
              }
            />
            <SummaryRow label="Total" value={format(totals.total)} emphasized />
          </dl>

          <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-5">
            <Button asChild variant="outline" size="compact">
              <SmartLink href="/?cart=1">Edit cart</SmartLink>
            </Button>
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Secure payment powered by Stripe
            </p>
          </div>
        </div>
      </Card>
    )
  }
)
CheckoutSummary.displayName = "CheckoutSummary"
