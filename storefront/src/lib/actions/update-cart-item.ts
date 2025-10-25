"use server"

import { revalidatePath } from "next/cache"

import type { HttpTypes } from "@medusajs/types"

import { updateCartLineItem } from "@/lib/cart"

export const updateCartItemQuantity = async (
  lineItemId: string,
  quantity: number,
  options: { redirectPath?: string } = {}
): Promise<HttpTypes.StoreCart> => {
  if (!lineItemId) {
    throw new Error("lineItemId is required")
  }

  const normalized = Math.max(1, Math.floor(quantity))

  const cart = await updateCartLineItem(lineItemId, normalized)
  revalidatePath("/", "layout")

  revalidatePath(options.redirectPath ?? "/cart")

  return cart
}
