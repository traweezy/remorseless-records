"use client"

import { useTransition, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { HttpTypes } from "@medusajs/types"

import { formatAmount } from "@/lib/money"
import { removeCartItem } from "@/lib/actions/remove-cart-item"
import { updateCartItemQuantity } from "@/lib/actions/update-cart-item"
import { startStripeCheckout } from "@/lib/actions/start-stripe-checkout"

import { cn } from "@/lib/ui/cn"

type CartLineItem = HttpTypes.StoreCartLineItem

type CartDrawerProps = {
  cart: HttpTypes.StoreCart
}

const CartDrawer = ({ cart }: CartDrawerProps) => {
  const [localItems, setLocalItems] = useState<CartLineItem[]>(cart.items ?? [])
  const [isPending, startTransition] = useTransition()

  const currency = cart.currency_code

  const subtotal = formatAmount(currency, Number(cart.subtotal ?? 0))
  const tax = formatAmount(currency, Number(cart.tax_total ?? 0))
  const shipping = formatAmount(currency, Number(cart.shipping_total ?? 0))
  const total = formatAmount(currency, Number(cart.total ?? 0))

  const handleQuantityChange = (lineItemId: string, quantity: number) => {
    setLocalItems((prev) =>
      prev.map((item) =>
        item.id === lineItemId ? { ...item, quantity } : item
      )
    )

    startTransition(async () => {
      try {
        await updateCartItemQuantity(lineItemId, quantity, { redirectPath: "/cart" })
      } catch (error) {
        console.error(error)
        toast.error("Failed to update quantity. Please try again.")
      }
    })
  }

  const handleRemove = (lineItemId: string) => {
    setLocalItems((prev) => prev.filter((item) => item.id !== lineItemId))

    startTransition(async () => {
      try {
        await removeCartItem(lineItemId, { redirectPath: "/cart" })
        toast.success("Removed from cart")
      } catch (error) {
        console.error(error)
        toast.error("Failed to remove item. Please try again.")
      }
    })
  }

  const handleCheckout = () => {
    startTransition(async () => {
      try {
        await startStripeCheckout(cart.id)
      } catch (error) {
        console.error(error)
        toast.error("Checkout failed. Please refresh and try again.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="space-y-3">
        {localItems.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/80 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-headline text-xs uppercase tracking-[0.35rem] text-foreground">
                  {item.title}
                </p>
                <p className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground">
                  {item.variant?.title ?? "Release"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-accent"
              >
                Remove
              </button>
            </div>
            <div className="flex items-center justify-between">
              <form
                action={(formData) => {
                  const quantity = Math.max(1, Number(formData.get("quantity")) || 1)
                  handleQuantityChange(item.id, quantity)
                }}
                className="flex items-center gap-2"
              >
                <label
                  className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground"
                  htmlFor={`quantity-${item.id}`}
                >
                  Qty
                </label>
                <input
                  id={`quantity-${item.id}`}
                  name="quantity"
                  defaultValue={Number(item.quantity ?? 1)}
                  min={1}
                  className="w-16 rounded border border-border/60 bg-background px-2 py-1 text-sm"
                  type="number"
                />
                <button
                  type="submit"
                  className="rounded-full border border-border/60 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-accent hover:text-accent"
                >
                  Update
                </button>
              </form>
              <span className="text-sm font-semibold text-accent">
                {formatAmount(
                  currency,
                  Number(item.total ?? item.subtotal ?? 0)
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
        <dl className="space-y-1 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
          <div className="flex items-center justify-between">
            <dt>Subtotal</dt>
            <dd>{subtotal}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Shipping</dt>
            <dd>{shipping}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Tax</dt>
            <dd>{tax}</dd>
          </div>
          <div className="flex items-center justify-between font-semibold text-foreground">
            <dt>Total</dt>
            <dd>{total}</dd>
          </div>
        </dl>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleCheckout}
        className={cn(
          "inline-flex w-full items-center justify-center rounded-full border border-accent px-6 py-3 text-xs uppercase tracking-[0.35rem] text-accent transition",
          "hover:bg-accent hover:text-background",
          isPending && "opacity-70"
        )}
      >
        {isPending ? "Preparing session…" : "Proceed to checkout"}
      </button>
      <Link
        href="/products"
        className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-accent"
      >
        Continue browsing
      </Link>
    </div>
  )
}

export default CartDrawer
