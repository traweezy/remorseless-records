"use server"

import { revalidatePath } from "next/cache"

import { removeItemFromCart } from "@/lib/cart"

export const removeCartItem = async (
  lineItemId: string,
  options: { redirectPath?: string } = {}
): Promise<void> => {
  if (!lineItemId) {
    throw new Error("lineItemId is required")
  }

  await removeItemFromCart(lineItemId)
  revalidatePath("/", "layout")

  revalidatePath(options.redirectPath ?? "/cart")
}
