"use client"

import type { HttpTypes } from "@medusajs/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"

import {
  addLineItem,
  addShippingMethod,
  calculateTaxes as calculateTaxesRequest,
  clearCartSession,
  completeCart as completeCartRequest,
  getCart,
  initPaymentSessions,
  listShippingOptions,
  removeLineItem,
  setAddresses,
  setEmail,
  updateLineItem,
} from "@/lib/cart/client"
import type { StoreCartAddressInput } from "@/lib/cart/types"

export type StoreCart = HttpTypes.StoreCart | null

type CartContextValue = {
  cart: StoreCart
  isLoading: boolean
  isMutating: boolean
  error: string | null
  itemCount: number
  subtotal: number | null
  taxTotal: number | null
  shippingTotal: number | null
  shippingSubtotal: number | null
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
  calculateTaxes: () => Promise<StoreCart | null>
  initPaymentSessions: () => Promise<{
    clientSecret: string | null
    providerId: string | null
  }>
  completeCart: () => Promise<HttpTypes.StoreCompleteCartResponse | null>
}

type CartMutation =
  | {
      kind: "add"
      variantId: string
      quantity: number
      showErrorToast: boolean
    }
  | {
      kind: "update"
      lineItemId: string
      quantity: number
      showErrorToast: boolean
    }
  | {
      kind: "remove"
      lineItemId: string
      showErrorToast: boolean
    }

const CART_QUERY_KEY = ["cart"] as const
const CART_BROADCAST_CHANNEL = "rr:cart"
const CART_STALE_TIME_MS = 30_000

const CartContext = createContext<CartContextValue | null>(null)

const deriveItemCount = (cart: StoreCart): number =>
  cart?.items?.reduce((total, item) => total + Number(item.quantity ?? 0), 0) ??
  0

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

  return cart
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
      quantity === 0
        ? (cart.items?.filter((item) => item.id !== lineItemId) ?? [])
        : (cart.items?.map((item) =>
            item.id === lineItemId ? { ...item, quantity } : item
          ) ?? []),
  }
}

const applyOptimisticMutation = (
  cart: StoreCart,
  mutation: CartMutation
): StoreCart => {
  switch (mutation.kind) {
    case "add":
      return applyOptimisticAdd(cart, mutation.variantId, mutation.quantity)
    case "update":
      return applyOptimisticUpdate(cart, mutation.lineItemId, mutation.quantity)
    case "remove":
      return applyOptimisticUpdate(cart, mutation.lineItemId, 0)
  }
}

const resolveErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback

const mutationFailureMessage = (mutation: CartMutation): string => {
  switch (mutation.kind) {
    case "add":
      return "Unable to add item to cart."
    case "update":
      return "Unable to update item quantity."
    case "remove":
      return "Unable to remove item from cart."
  }
}

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient()
  const [operationError, setOperationError] = useState<string | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const cartQuery = useQuery({
    queryKey: CART_QUERY_KEY,
    queryFn: getCart,
    staleTime: CART_STALE_TIME_MS,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    meta: { persist: false },
  })
  const cart = cartQuery.data ?? null

  const announceMutation = useCallback(() => {
    channelRef.current?.postMessage("cart-mutated")
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return
    }

    const channel = new BroadcastChannel(CART_BROADCAST_CHANNEL)
    channelRef.current = channel
    channel.addEventListener("message", () => {
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
    })

    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [queryClient])

  const cartMutation = useMutation({
    mutationKey: ["cart", "mutation"],
    scope: { id: "cart" },
    retry: false,
    mutationFn: async (mutation: CartMutation): Promise<StoreCart> => {
      const previousCart =
        queryClient.getQueryData<StoreCart>(CART_QUERY_KEY) ?? null
      queryClient.setQueryData<StoreCart>(
        CART_QUERY_KEY,
        applyOptimisticMutation(previousCart, mutation)
      )

      try {
        let nextCart: HttpTypes.StoreCart
        switch (mutation.kind) {
          case "add":
            nextCart = await addLineItem(mutation.variantId, mutation.quantity)
            break
          case "update":
            nextCart = await updateLineItem(
              mutation.lineItemId,
              mutation.quantity
            )
            break
          case "remove":
            nextCart = await removeLineItem(mutation.lineItemId)
            break
        }

        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, nextCart)
        setOperationError(null)
        announceMutation()
        await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
        return nextCart
      } catch (error: unknown) {
        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, previousCart)
        const message = resolveErrorMessage(
          error,
          mutationFailureMessage(mutation)
        )
        setOperationError(message)
        if (mutation.showErrorToast) {
          toast.error(message)
        }
        await queryClient
          .refetchQueries({ queryKey: CART_QUERY_KEY })
          .catch(() => undefined)
        throw error
      }
    },
  })

  const refreshCart = useCallback(
    async (_options?: { silent?: boolean }): Promise<StoreCart | null> => {
      try {
        const nextCart = await queryClient.fetchQuery({
          queryKey: CART_QUERY_KEY,
          queryFn: getCart,
          staleTime: 0,
        })
        setOperationError(null)
        return nextCart
      } catch (error: unknown) {
        setOperationError(
          resolveErrorMessage(error, "Unable to load the cart.")
        )
        return null
      }
    },
    [queryClient]
  )

  const addItem = useCallback(
    async (variantId: string, quantity = 1) => {
      await cartMutation.mutateAsync({
        kind: "add",
        variantId,
        quantity,
        showErrorToast: false,
      })
    },
    [cartMutation]
  )

  const updateItem = useCallback(
    async (lineItemId: string, quantity: number) => {
      if (!cart?.id) {
        throw new Error("No active cart")
      }
      await cartMutation.mutateAsync({
        kind: "update",
        lineItemId,
        quantity: Math.max(0, quantity),
        showErrorToast: true,
      })
    },
    [cart, cartMutation]
  )

  const removeItem = useCallback(
    async (lineItemId: string) => {
      if (!cart?.id) {
        throw new Error("No active cart")
      }
      await cartMutation.mutateAsync({
        kind: "remove",
        lineItemId,
        showErrorToast: true,
      })
    },
    [cart, cartMutation]
  )

  const updateEmail = useCallback(
    async (email: string) => {
      if (!cart?.id) {
        return null
      }

      try {
        const updatedCart = await setEmail(cart.id, email)
        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, updatedCart)
        setOperationError(null)
        return updatedCart
      } catch (error: unknown) {
        const message = resolveErrorMessage(error, "Unable to update email.")
        setOperationError(message)
        toast.error(message)
        return null
      }
    },
    [cart, queryClient]
  )

  const updateAddresses = useCallback(
    async (addresses: {
      shipping_address: StoreCartAddressInput
      billing_address?: StoreCartAddressInput
    }) => {
      if (!cart?.id) {
        return null
      }

      try {
        const updatedCart = await setAddresses(cart.id, addresses)
        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, updatedCart)
        setOperationError(null)
        return updatedCart
      } catch (error: unknown) {
        const message = resolveErrorMessage(
          error,
          "Unable to update addresses."
        )
        setOperationError(message)
        toast.error(message)
        return null
      }
    },
    [cart, queryClient]
  )

  const loadShippingOptions = useCallback(
    async (cartIdOverride?: string) => {
      const cartId = cartIdOverride ?? cart?.id
      if (!cartId) {
        return []
      }

      try {
        return await listShippingOptions(cartId)
      } catch (error: unknown) {
        const message = resolveErrorMessage(
          error,
          "Unable to load shipping options."
        )
        setOperationError(message)
        toast.error(message)
        return []
      }
    },
    [cart]
  )

  const applyShippingMethod = useCallback(
    async (optionId: string) => {
      if (!cart?.id) {
        return null
      }

      try {
        const updatedCart = await addShippingMethod(cart.id, optionId)
        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, updatedCart)
        setOperationError(null)
        return updatedCart
      } catch (error: unknown) {
        const message = resolveErrorMessage(
          error,
          "Unable to add shipping method."
        )
        setOperationError(message)
        toast.error(message)
        return null
      }
    },
    [cart, queryClient]
  )

  const applyTaxes = useCallback(async () => {
    if (!cart?.id) {
      return null
    }

    try {
      const updatedCart = await calculateTaxesRequest(cart.id)
      queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, updatedCart)
      setOperationError(null)
      return updatedCart
    } catch (error: unknown) {
      const message = resolveErrorMessage(error, "Unable to calculate taxes.")
      setOperationError(message)
      toast.error(message)
      return null
    }
  }, [cart, queryClient])

  const initializePaymentSessions = useCallback(async () => {
    if (!cart?.id) {
      return { clientSecret: null, providerId: null }
    }

    try {
      const session = await initPaymentSessions(cart.id)
      return {
        clientSecret: session.client_secret,
        providerId: session.provider_id,
      }
    } catch (error: unknown) {
      const message = resolveErrorMessage(
        error,
        "Unable to initialize payment session."
      )
      setOperationError(message)
      toast.error(message)
      return { clientSecret: null, providerId: null }
    }
  }, [cart])

  const finishCart = useCallback(async () => {
    if (!cart?.id) {
      return null
    }

    try {
      const response = await completeCartRequest(cart.id)
      if (response.type === "order") {
        await clearCartSession()
        queryClient.setQueryData<StoreCart>(CART_QUERY_KEY, null)
        announceMutation()
      }
      return response
    } catch (error: unknown) {
      const message = resolveErrorMessage(error, "Unable to complete cart.")
      setOperationError(message)
      toast.error(message)
      return null
    }
  }, [announceMutation, cart, queryClient])

  const totals = useMemo(
    () => ({
      itemCount: deriveItemCount(cart),
      subtotal: cart?.subtotal ?? null,
      taxTotal: cart?.tax_total ?? null,
      shippingTotal: cart?.shipping_total ?? null,
      shippingSubtotal: cart?.shipping_subtotal ?? null,
      discountTotal: cart?.discount_total ?? null,
      total: cart?.total ?? null,
    }),
    [cart]
  )

  const queryError = cartQuery.error
    ? resolveErrorMessage(cartQuery.error, "Unable to load the cart.")
    : null
  const mutationError = cartMutation.error
    ? resolveErrorMessage(cartMutation.error, "Unable to update the cart.")
    : null
  const error = operationError ?? mutationError ?? queryError

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isLoading: cartQuery.isPending,
      isMutating: cartMutation.isPending,
      error,
      itemCount: totals.itemCount,
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      shippingTotal: totals.shippingTotal,
      shippingSubtotal: totals.shippingSubtotal,
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
      calculateTaxes: applyTaxes,
      initPaymentSessions: initializePaymentSessions,
      completeCart: finishCart,
    }),
    [
      addItem,
      applyShippingMethod,
      applyTaxes,
      cart,
      cartMutation.isPending,
      cartQuery.isPending,
      error,
      finishCart,
      initializePaymentSessions,
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
