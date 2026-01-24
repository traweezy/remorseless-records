"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { HttpTypes } from "@medusajs/types"

import {
  addLineItem,
  addShippingMethod,
  completeCart as completeCartRequest,
  createCart,
  getCart,
  initPaymentSessions,
  listShippingOptions,
  removeLineItem,
  setAddresses,
  setEmail,
  updateLineItem,
} from "@/lib/cart/client"
import { clearCartId, getCartId, setCartId } from "@/lib/cart/storage"
import type { StoreCartAddressInput } from "@/lib/cart/types"

export type StoreCart = HttpTypes.StoreCart | null

type CartContextValue = {
  cart: StoreCart
  isLoading: boolean
  error: string | null
  itemCount: number
  subtotal: number | null
  taxTotal: number | null
  shippingTotal: number | null
  discountTotal: number | null
  total: number | null
  refreshCart: (options?: { silent?: boolean }) => Promise<StoreCart | null>
  addItem: (variantId: string, quantity?: number) => Promise<void>
  updateItem: (lineItemId: string, quantity: number) => Promise<void>
  removeItem: (lineItemId: string) => Promise<void>
  setEmail: (email: string) => Promise<StoreCart | null>
  setAddresses: (addresses: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  }) => Promise<StoreCart | null>
  listShippingOptions: (
    cartIdOverride?: string
  ) => Promise<HttpTypes.StoreCartShippingOptionWithServiceZone[]>
  addShippingMethod: (optionId: string) => Promise<StoreCart | null>
  initPaymentSessions: () => Promise<{
    clientSecret: string | null
    providerId: string | null
  }>
  completeCart: () => Promise<HttpTypes.StoreCompleteCartResponse | null>
}

const CartContext = createContext<CartContextValue | null>(null)

const deriveItemCount = (cart: StoreCart): number =>
  cart?.items?.reduce(
    (total, item) => total + Number(item.quantity ?? 0),
    0
  ) ?? 0

const applyOptimisticAdd = (
  cart: StoreCart,
  variantId: string,
  quantity: number
): StoreCart => {
  if (!cart) {
    return cart
  }

  const items = cart.items ?? []
  const existing = items.find((item) => item.variant_id === variantId)

  if (existing) {
    return {
      ...cart,
      items: items.map((item) =>
        item.id === existing.id
          ? { ...item, quantity: Number(item.quantity ?? 0) + quantity }
          : item
      ),
    }
  }

  const optimisticItem = {
    id: `optimistic-${variantId}-${Date.now()}`,
    variant_id: variantId,
    title: "Adding item",
    quantity,
    subtotal: 0,
    total: 0,
  } as HttpTypes.StoreCartLineItem

  return {
    ...cart,
    items: [...items, optimisticItem],
  }
}

const applyOptimisticUpdate = (
  cart: StoreCart,
  lineItemId: string,
  quantity: number
): StoreCart => {
  if (!cart) {
    return cart
  }

  return {
    ...cart,
    items:
      cart.items?.map((item) =>
        item.id === lineItemId ? { ...item, quantity } : item
      ) ?? [],
  }
}

const applyOptimisticRemove = (
  cart: StoreCart,
  lineItemId: string
): StoreCart => {
  if (!cart) {
    return cart
  }

  return {
    ...cart,
    items: cart.items?.filter((item) => item.id !== lineItemId) ?? [],
  }
}

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [cart, setCart] = useState<StoreCart>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cartRef = useRef<StoreCart>(null)
  const mutationRef = useRef(0)

  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  const refreshCart = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      if (!silent) {
        setIsLoading(true)
      }

      try {
        const storedId = getCartId()
        if (!storedId) {
          const newCart = await createCart()
          setCartId(newCart.id)
          setCart(newCart)
          setError(null)
          return newCart
        }

        const existingCart = await getCart(storedId)
        if (!existingCart) {
          clearCartId()
          const newCart = await createCart()
          setCartId(newCart.id)
          setCart(newCart)
          setError(null)
          return newCart
        }

        setCart(existingCart)
        setError(null)
        return existingCart
      } catch (fetchError) {
        const message = resolveErrorMessage(fetchError, "Unable to load cart.")
        setError(message)
        return null
      } finally {
        if (!silent) {
          setIsLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void refreshCart()
  }, [refreshCart])

  const runMutation = useCallback(
    async (
      optimisticUpdate: (current: StoreCart) => StoreCart,
      action: () => Promise<StoreCart>,
      failureMessage: string,
      options?: { showToast?: boolean }
    ) => {
      const requestId = ++mutationRef.current
      const previousCart = cartRef.current

      setCart((current) => optimisticUpdate(current))

      try {
        const nextCart = await action()
        if (nextCart?.id) {
          setCartId(nextCart.id)
        }

        if (requestId === mutationRef.current) {
          setCart(nextCart)
          setError(null)
        }
        return nextCart
      } catch (mutationError) {
        if (requestId === mutationRef.current) {
          setCart(previousCart ?? null)
        }
        const message = resolveErrorMessage(mutationError, failureMessage)
        setError(message)
        if (options?.showToast ?? true) {
          toast.error(message)
        }
        await refreshCart({ silent: true })
        throw mutationError
      }
    },
    [refreshCart]
  )

  const addItem = useCallback(
    async (variantId: string, quantity = 1) => {
      const refreshed = await refreshCart({ silent: true })
      const resolvedCartId = getCartId() ?? refreshed?.id ?? cart?.id
      if (!resolvedCartId) {
        throw new Error("Unable to resolve cart id")
      }

      await runMutation(
        (current) => applyOptimisticAdd(current, variantId, quantity),
        () => addLineItem(resolvedCartId, variantId, quantity),
        "Unable to add item to cart.",
        { showToast: false }
      )
    },
    [cart?.id, refreshCart, runMutation]
  )

  const updateItem = useCallback(
    async (lineItemId: string, quantity: number) => {
      const cartId = getCartId() ?? cart?.id
      if (!cartId) {
        throw new Error("No active cart")
      }

      await runMutation(
        (current) => applyOptimisticUpdate(current, lineItemId, quantity),
        () => updateLineItem(cartId, lineItemId, quantity),
        "Unable to update item quantity."
      )
    },
    [cart?.id, runMutation]
  )

  const removeItem = useCallback(
    async (lineItemId: string) => {
      const cartId = getCartId() ?? cart?.id
      if (!cartId) {
        throw new Error("No active cart")
      }

      await runMutation(
        (current) => applyOptimisticRemove(current, lineItemId),
        () => removeLineItem(cartId, lineItemId),
        "Unable to remove item from cart."
      )
    },
    [cart?.id, runMutation]
  )

  const updateEmail = useCallback(
    async (email: string) => {
      const cartId = getCartId() ?? cart?.id
      if (!cartId) {
        return null
      }

      try {
        const updatedCart = await setEmail(cartId, email)
        setCart(updatedCart)
        setError(null)
        return updatedCart
      } catch (mutationError) {
        const message = resolveErrorMessage(mutationError, "Unable to update email.")
        setError(message)
        toast.error(message)
        return null
      }
    },
    [cart?.id]
  )

  const updateAddresses = useCallback(
    async (addresses: {
      shipping_address: StoreCartAddressInput
      billing_address?: StoreCartAddressInput
    }) => {
      const cartId = getCartId() ?? cart?.id
      if (!cartId) {
        return null
      }

      try {
        const updatedCart = await setAddresses(cartId, addresses)
        setCart(updatedCart)
        setError(null)
        return updatedCart
      } catch (mutationError) {
        const message = resolveErrorMessage(
          mutationError,
          "Unable to update addresses."
        )
        setError(message)
        toast.error(message)
        return null
      }
    },
    [cart?.id]
  )

  const loadShippingOptions = useCallback(
    async (cartIdOverride?: string) => {
      const cartId = cartIdOverride ?? getCartId() ?? cart?.id
      if (!cartId) {
        return []
      }

      try {
        return await listShippingOptions(cartId)
      } catch (fetchError) {
        const message = resolveErrorMessage(
          fetchError,
          "Unable to load shipping options."
        )
        setError(message)
        toast.error(message)
        return []
      }
    },
    [cart?.id]
  )

  const applyShippingMethod = useCallback(
    async (optionId: string) => {
      const cartId = getCartId() ?? cart?.id
      if (!cartId) {
        return null
      }

      try {
        const updatedCart = await addShippingMethod(cartId, optionId)
        setCart(updatedCart)
        setError(null)
        return updatedCart
      } catch (mutationError) {
        const message = resolveErrorMessage(
          mutationError,
          "Unable to add shipping method."
        )
        setError(message)
        toast.error(message)
        return null
      }
    },
    [cart?.id]
  )

  const initializePaymentSessions = useCallback(async () => {
    const cartId = getCartId() ?? cart?.id
    if (!cartId) {
      return { clientSecret: null, providerId: null }
    }

    try {
      const session = await initPaymentSessions(cartId)
      return {
        clientSecret: session.client_secret,
        providerId: session.provider_id,
      }
    } catch (mutationError) {
      const message = resolveErrorMessage(
        mutationError,
        "Unable to initialize payment session."
      )
      setError(message)
      toast.error(message)
      return { clientSecret: null, providerId: null }
    }
  }, [cart?.id])

  const finishCart = useCallback(async () => {
    const cartId = getCartId() ?? cart?.id
    if (!cartId) {
      return null
    }

    try {
      const response = await completeCartRequest(cartId)

      if (response.type === "order") {
        clearCartId()
        setCart(null)
      }

      return response
    } catch (mutationError) {
      const message = resolveErrorMessage(mutationError, "Unable to complete cart.")
      setError(message)
      toast.error(message)
      return null
    }
  }, [cart?.id])

  const totals = useMemo(
    () => ({
      itemCount: deriveItemCount(cart),
      subtotal: cart?.subtotal ?? null,
      taxTotal: cart?.tax_total ?? null,
      shippingTotal: cart?.shipping_total ?? null,
      discountTotal: cart?.discount_total ?? null,
      total: cart?.total ?? null,
    }),
    [cart]
  )

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isLoading,
      error,
      itemCount: totals.itemCount,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      shippingTotal: totals.shippingTotal,
      discountTotal: totals.discountTotal,
      total: totals.total,
      refreshCart,
      addItem,
      updateItem,
      removeItem,
      setEmail: updateEmail,
      setAddresses: updateAddresses,
      listShippingOptions: loadShippingOptions,
      addShippingMethod: applyShippingMethod,
      initPaymentSessions: initializePaymentSessions,
      completeCart: finishCart,
    }),
    [
      addItem,
      applyShippingMethod,
      cart,
      error,
      finishCart,
      initializePaymentSessions,
      isLoading,
      loadShippingOptions,
      refreshCart,
      removeItem,
      totals,
      updateAddresses,
      updateEmail,
      updateItem,
    ]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = (): CartContextValue => {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error("useCart must be used within CartProvider")
  }

  return context
}
