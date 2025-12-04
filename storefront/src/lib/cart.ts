import { cookies } from "next/headers"

import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"

export const CART_COOKIE = "rr_cart_id"

let cachedRegionId: string | null = null

const getDefaultRegionId = async (): Promise<string> => {
  if (cachedRegionId) {
    return cachedRegionId
  }

  const { regions } = await storeClient.region.list({ limit: 1 })

  const region = regions[0]
  if (!region) {
    throw new Error("No regions configured in Medusa")
  }

  cachedRegionId = region.id
  return cachedRegionId
}

export const getOrCreateCartId = async (): Promise<string> => {
  const cookieStore = await cookies()
  const existing = cookieStore.get(CART_COOKIE)?.value

  if (existing) {
    return existing
  }

  const regionId = await getDefaultRegionId()
  const { cart } = await storeClient.cart.create({ region_id: regionId })

  cookieStore.set(CART_COOKIE, cart.id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  })

  return cart.id
}

export const getCart = async (): Promise<HttpTypes.StoreCart | null> => {
  const cookieStore = await cookies()
  const cartId = cookieStore.get(CART_COOKIE)?.value
  if (!cartId) {
    return null
  }

  return getCartById(cartId)
}

export const getCartById = async (cartId: string): Promise<HttpTypes.StoreCart | null> => {
  try {
    const { cart } = await storeClient.cart.retrieve(cartId, {
      fields:
        "id,items,items.title,items.quantity,items.total,items.subtotal,items.variant,items.variant.calculated_price,subtotal,total,shipping_total,tax_total,currency_code",
    })
    return cart
  } catch (error) {
    console.error("Failed to retrieve cart", error)
    return null
  }
}

export const addItemToCart = async (
  variantId: string,
  quantity = 1
): Promise<HttpTypes.StoreCart> => {
  const cartId = await getOrCreateCartId()

  const { cart } = await storeClient.cart.createLineItem(cartId, {
    variant_id: variantId,
    quantity,
  })

  return cart
}

export const removeItemFromCart = async (
  lineItemId: string
): Promise<HttpTypes.StoreCart> => {
  const cookieStore = await cookies()
  const cartId = cookieStore.get(CART_COOKIE)?.value
  if (!cartId) {
    throw new Error("No active cart")
  }

  await storeClient.cart.deleteLineItem(cartId, lineItemId)

  const { cart } = await storeClient.cart.retrieve(cartId, {
    fields:
      "id,items,items.title,items.quantity,items.total,items.subtotal,subtotal,total,shipping_total,tax_total,currency_code",
  })

  return cart
}

export const updateCartLineItem = async (
  lineItemId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const cookieStore = await cookies()
  const cartId = cookieStore.get(CART_COOKIE)?.value
  if (!cartId) {
    throw new Error("No active cart")
  }

  await storeClient.cart.updateLineItem(cartId, lineItemId, {
    quantity,
  })

  const { cart } = await storeClient.cart.retrieve(cartId, {
    fields:
      "id,items,items.title,items.quantity,items.total,items.subtotal,subtotal,total,shipping_total,tax_total,currency_code",
  })

  return cart
}
