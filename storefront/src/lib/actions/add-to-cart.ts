"use server"

import { revalidatePath } from "next/cache"

import { addItemToCart } from "@/lib/cart"

type AddToCartInput = {
  variantId: string
  quantity?: number
  redirectTo?: string
}

export const addToCart = async ({
  variantId,
  quantity = 1,
  redirectTo,
}: AddToCartInput): Promise<void> => {
  if (!variantId) {
    throw new Error("variantId is required")
  }

  await addItemToCart(variantId, quantity)
  revalidatePath("/", "layout")

  revalidatePath(redirectTo ?? "/cart")
}
