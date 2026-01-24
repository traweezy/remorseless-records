"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, PackageOpen } from "lucide-react"
import type { HttpTypes } from "@medusajs/types"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import SmartLink from "@/components/ui/smart-link"
import { formatAmount } from "@/lib/money"
import { useCart } from "@/providers/cart-provider"

const CheckoutSuccessPage = () => {
  const searchParams = useSearchParams()
  const { completeCart } = useCart()
  const [order, setOrder] = useState<HttpTypes.StoreOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const orderId = searchParams.get("order_id")
  const displayId = searchParams.get("display_id")
  const cartId = searchParams.get("cart_id")

  const finalizeOrder = useCallback(async () => {
    if (orderId || !cartId) {
      return
    }

    setIsLoading(true)
    try {
      const response = await completeCart()
      if (response?.type === "order") {
        setOrder(response.order)
      } else if (response?.type === "cart") {
        setError(response.error?.message ?? "Unable to finalize order.")
      }
    } catch (finalizeError) {
      console.error("Failed to complete cart", finalizeError)
      setError("Unable to finalize order.")
    } finally {
      setIsLoading(false)
    }
  }, [cartId, completeCart, orderId])

  useEffect(() => {
    void finalizeOrder()
  }, [finalizeOrder])

  const currencyCode = order?.currency_code ?? "usd"
  const summary = useMemo(() => {
    if (!order) {
      return null
    }

    return {
      total: formatAmount(currencyCode, Number(order.total ?? 0)),
      subtotal: formatAmount(currencyCode, Number(order.subtotal ?? 0)),
      tax: formatAmount(currencyCode, Number(order.tax_total ?? 0)),
      shipping: formatAmount(currencyCode, Number(order.shipping_total ?? 0)),
    }
  }, [currencyCode, order])

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-16">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16">
      <div className="flex items-center gap-3 text-accent">
        <CheckCircle2 className="h-6 w-6" />
        <span className="text-xs uppercase tracking-[0.3rem]">Order confirmed</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thank you for your order</CardTitle>
          <CardDescription>
            {orderId || displayId
              ? `Order ${displayId ? `#${displayId}` : orderId}`
              : "We're preparing your receipt now."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {order ? (
            <div className="space-y-4">
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="text-foreground font-semibold">
                  {order.email ?? "Confirmation will be sent to your email."}
                </p>
                <p>
                  Total paid: <span className="font-semibold text-foreground">{summary?.total}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                  Items
                </p>
                <ul className="mt-3 space-y-3">
                  {order.items?.map((item) => (
                    <li key={item.id} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">
                        {item.title} x {item.quantity}
                      </span>
                      <span className="font-semibold text-foreground">
                        {formatAmount(currencyCode, Number(item.total ?? 0))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
              <PackageOpen className="h-4 w-4" />
              We're finalizing your receipt. You'll receive an email shortly.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <SmartLink href="/catalog" nativePrefetch>
                Continue shopping
              </SmartLink>
            </Button>
            <Button asChild variant="outline">
              <SmartLink href="/" nativePrefetch>
                Return home
              </SmartLink>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default CheckoutSuccessPage
