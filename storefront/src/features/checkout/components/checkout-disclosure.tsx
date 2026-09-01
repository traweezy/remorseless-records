"use client"

import { memo } from "react"

import SmartLink from "@/components/ui/smart-link"
import { legalConfig, legalRoutes } from "@/config/legal"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"
import { formatAmount } from "@/lib/money"

type CheckoutDisclosureProps = {
  checkout: CheckoutProjection
  id: string
}

export const CheckoutDisclosure = memo<CheckoutDisclosureProps>(
  ({ checkout, id }) => {
    const { totals } = checkout.cart
    const total = formatAmount(totals.currencyCode, totals.total)
    const shipping = formatAmount(totals.currencyCode, totals.shippingTotal)
    const tax = formatAmount(totals.currencyCode, totals.taxTotal)

    return (
      <div
        id={id}
        className="space-y-2 rounded-2xl border border-border/60 bg-background/70 p-4 text-xs leading-5 text-muted-foreground"
      >
        <p className="font-semibold text-foreground">
          {totals.total > 0
            ? `Submitting authorizes a ${total} payment now.`
            : `Submitting places this order with ${total} due now.`}
        </p>
        <p>
          The total includes {shipping} shipping and{" "}
          {totals.taxCollectionMode === "disabled"
            ? "no tax collected"
            : `${tax} tax`}
          .
        </p>
        <p>
          Orders normally process in {legalConfig.shipping.processingWindow}.
          Carrier transit begins after processing.
        </p>
        <p>
          By placing the order, you agree to our{" "}
          <SmartLink
            href={legalRoutes.terms}
            className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
          >
            Terms
          </SmartLink>
          . Review our{" "}
          <SmartLink
            href={legalRoutes.privacy}
            className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
          >
            Privacy
          </SmartLink>
          ,{" "}
          <SmartLink
            href={legalRoutes.shipping}
            className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
          >
            Shipping
          </SmartLink>
          , and{" "}
          <SmartLink
            href={legalRoutes.returns}
            className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
          >
            Returns
          </SmartLink>{" "}
          policies before submitting.
        </p>
      </div>
    )
  }
)
CheckoutDisclosure.displayName = "CheckoutDisclosure"
