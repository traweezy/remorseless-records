"use server"

import { revalidatePath } from "next/cache"

import type { HttpTypes } from "@medusajs/types"

import { removeItemFromCart } from "@/lib/cart"

export const removeCartItem = async (
  lineItemId: string,
  options: { redirectPath?: string } = {}
): Promise<HttpTypes.StoreCart> => {
  if (!lineItemId) {
    throw new Error("lineItemId is required")
  }

  const cart = await removeItemFromCart(lineItemId)
  revalidatePath("/", "layout")

  revalidatePath(options.redirectPath ?? "/cart")

  return cart
}
