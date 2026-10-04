import type { HttpTypes } from "@medusajs/types"

import { CartSnapshotError } from "@/lib/cart/snapshot"
import { readStoreProductListResponse } from "@/lib/products/response-contract"
import {
  readBoundedText,
  readNonNegativeSafeInteger,
} from "@/lib/provider-boundary"

type InventoryReader = (input: {
  productIds: string[]
  salesChannelId: string
}) => Promise<unknown>

function invalidInventory(): never {
  throw new CartSnapshotError("The cart inventory response is malformed.")
}

// Native cart reads do not compute inventory_quantity. Native product reads
// compute availability for the requested sales channel, including reservations.
export const resolveCartInventory = async (
  cart: HttpTypes.StoreCart,
  read: InventoryReader
): Promise<HttpTypes.StoreCart> => {
  // Completed-cart recovery must not depend on today's catalog or stock.
  if (cart.completed_at) return cart
  if (!Array.isArray(cart.items)) invalidInventory()
  const managedItems = cart.items.filter(
    (item) =>
      item.variant?.manage_inventory === true &&
      item.variant.allow_backorder !== true
  )
  if (!managedItems.length) return cart

  const salesChannelId = readBoundedText(cart.sales_channel_id)
  if (!salesChannelId || !/^sc_[A-Za-z0-9]+$/.test(salesChannelId))
    invalidInventory()
  const productIds = [
    ...new Set(
      managedItems.map((item) => {
        const id = readBoundedText(item.product_id)
        if (
          !id ||
          !/^prod_[A-Za-z0-9]+$/.test(id) ||
          item.product?.id !== id ||
          item.variant?.id !== item.variant_id
        )
          invalidInventory()
        return id
      })
    ),
  ]
  if (productIds.length > 100) invalidInventory()
  const { products } = readStoreProductListResponse(
    await read({ productIds, salesChannelId }),
    productIds.length
  )
  const expectedIds = new Set(productIds)
  if (
    products.length !== expectedIds.size ||
    products.some((p) => !expectedIds.has(p.id))
  )
    invalidInventory()
  const byId = new Map(products.map((product) => [product.id, product]))
  const quantities = new Map<string, number>()
  for (const item of managedItems) {
    const matches =
      byId
        .get(item.product_id!)
        ?.variants?.filter((variant) => variant.id === item.variant_id) ?? []
    const variant = matches[0]
    const quantity = readNonNegativeSafeInteger(variant?.inventory_quantity)
    if (
      matches.length !== 1 ||
      variant?.manage_inventory !== true ||
      variant.allow_backorder !== item.variant!.allow_backorder ||
      quantity === null
    )
      invalidInventory()
    quantities.set(item.id, quantity)
  }
  return {
    ...cart,
    items: cart.items.map((item) =>
      quantities.has(item.id)
        ? {
            ...item,
            variant: {
              ...item.variant!,
              inventory_quantity: quantities.get(item.id)!,
            },
          }
        : item
    ),
  }
}
