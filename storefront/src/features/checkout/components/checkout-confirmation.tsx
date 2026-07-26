"use client"

import { useQuery } from "@tanstack/react-query"
import { Check, Mail, MapPin, PackageCheck } from "lucide-react"
import Image from "next/image"
import { memo, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import SmartLink from "@/components/ui/smart-link"
import { legalConfig } from "@/config/legal"
import {
  CheckoutApiError,
  getCheckoutReceipt,
} from "@/features/checkout/api/checkout-api"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import { formatAmount } from "@/lib/money"

const CheckoutConfirmationSkeleton = memo(() => (
  <div
    className="mx-auto w-full max-w-4xl space-y-6 px-4 py-12 sm:px-6 lg:py-16"
    role="status"
  >
    <Skeleton className="mx-auto h-20 w-80 max-w-full rounded-2xl" />
    <Skeleton className="h-[34rem] w-full rounded-3xl" />
    <span className="sr-only">Loading order receipt…</span>
  </div>
))
CheckoutConfirmationSkeleton.displayName = "CheckoutConfirmationSkeleton"

export const CheckoutConfirmation = memo(() => {
  const receiptQuery = useQuery({
    queryKey: ["checkout", "confirmation"],
    queryFn: getCheckoutReceipt,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    meta: { persist: false },
  })
  const receipt = receiptQuery.data
  const placedAt = useMemo(
    () =>
      receipt
        ? new Intl.DateTimeFormat("en-US", {
            dateStyle: "long",
            timeStyle: "short",
          }).format(new Date(receipt.placedAt))
        : null,
    [receipt]
  )

  if (receiptQuery.isPending) {
    return <CheckoutConfirmationSkeleton />
  }

  if (!receipt) {
    const message =
      receiptQuery.error instanceof CheckoutApiError
        ? receiptQuery.error.problem.detail
        : "The receipt could not be loaded. Check your email or try again."
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-16 sm:px-6">
        <div className="w-full space-y-5">
          <CheckoutProblem
            title="Receipt is unavailable"
            message={message}
            onRetry={() => void receiptQuery.refetch()}
          />
          <div className="flex justify-center">
            <Button asChild variant="outline">
              <SmartLink href="/catalog">Continue shopping</SmartLink>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const format = (amount: number): string =>
    formatAmount(receipt.totals.currencyCode, amount)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
      <header className="mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
          <Check className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14rem] text-destructive sm:tracking-[0.24rem]">
          Order confirmed
        </p>
        <h1 className="mt-2 font-headline text-3xl uppercase tracking-[0.12rem] text-foreground sm:text-5xl sm:tracking-[0.18rem]">
          Thank you
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {receipt.orderNumber ? `Order #${receipt.orderNumber} · ` : ""}
          {placedAt}
        </p>
      </header>

      <Card variant="panel">
        <CardHeader>
          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/70 p-4">
            <Mail
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold text-foreground">
                Confirmation sent
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We sent the receipt and future shipping updates to{" "}
                <span className="font-semibold text-foreground">
                  {receipt.email}
                </span>
                .
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <section aria-labelledby="receipt-items-heading">
            <h2
              id="receipt-items-heading"
              className="font-headline text-xl uppercase tracking-[0.18rem] text-foreground"
            >
              Items
            </h2>
            <ul className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/70 px-4">
              {receipt.items.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 items-center gap-3 py-4"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {item.thumbnail ? (
                      <Image
                        src={item.thumbnail}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <PackageCheck
                        className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.variantTitle ? `${item.variantTitle} · ` : ""}
                      Qty {item.quantity}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold text-foreground">
                    {format(item.total)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            {receipt.deliveryAddress ? (
              <section
                aria-labelledby="receipt-delivery-heading"
                className="rounded-2xl border border-border/60 bg-background/70 p-5"
              >
                <h2
                  id="receipt-delivery-heading"
                  className="flex items-center gap-2 font-semibold text-foreground"
                >
                  <MapPin
                    className="h-4 w-4 text-destructive"
                    aria-hidden="true"
                  />
                  Delivery
                </h2>
                <address className="mt-3 text-sm not-italic leading-6 text-muted-foreground">
                  <span className="block text-foreground">
                    {receipt.deliveryAddress.firstName}{" "}
                    {receipt.deliveryAddress.lastName}
                  </span>
                  <span className="block">
                    {receipt.deliveryAddress.address1}
                  </span>
                  {receipt.deliveryAddress.address2 ? (
                    <span className="block">
                      {receipt.deliveryAddress.address2}
                    </span>
                  ) : null}
                  <span className="block">
                    {receipt.deliveryAddress.city},{" "}
                    {receipt.deliveryAddress.province}{" "}
                    {receipt.deliveryAddress.postalCode}
                  </span>
                  <span className="block">
                    {receipt.deliveryAddress.countryCode}
                  </span>
                </address>
                {receipt.deliveryMethod ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {receipt.deliveryMethod}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section
              aria-labelledby="receipt-total-heading"
              className="rounded-2xl border border-border/60 bg-background/70 p-5"
            >
              <h2
                id="receipt-total-heading"
                className="font-semibold text-foreground"
              >
                Payment summary
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>{format(receipt.totals.subtotal)}</dd>
                </div>
                {receipt.totals.discountTotal > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Discount</dt>
                    <dd>−{format(receipt.totals.discountTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd>{format(receipt.totals.shippingTotal)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd>{format(receipt.totals.taxTotal)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-border/60 pt-3 text-base font-semibold text-foreground">
                  <dt>Total paid</dt>
                  <dd>{format(receipt.totals.total)}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="flex flex-col items-center gap-4 border-t border-border/60 pt-7 text-center">
            <Button asChild>
              <SmartLink href="/catalog">Continue shopping</SmartLink>
            </Button>
            <p className="text-xs text-muted-foreground">
              Questions? Email{" "}
              <a
                href={`mailto:${legalConfig.supportEmail}`}
                className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4"
              >
                {legalConfig.supportEmail}
              </a>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
})
CheckoutConfirmation.displayName = "CheckoutConfirmation"
