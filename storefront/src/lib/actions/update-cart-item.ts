"use server"

import { revalidatePath } from "next/cache"

import { updateCartLineItem } from "@/lib/cart"

export const updateCartItemQuantity = async (
  lineItemId: string,
  quantity: number,
  options: { redirectPath?: string } = {}
): Promise<void> => {
  if (!lineItemId) {
    throw new Error("lineItemId is required")
  }

  const normalized = Math.max(1, Math.floor(quantity))

  await updateCartLineItem(lineItemId, normalized)
  revalidatePath("/", "layout")

  revalidatePath(options.redirectPath ?? "/cart")
}
