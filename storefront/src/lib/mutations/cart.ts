"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { removeCartItem } from "@/lib/actions/remove-cart-item"
import { updateCartItemQuantity } from "@/lib/actions/update-cart-item"
import { safeLogError } from "@/lib/logging"

import type { StoreCart } from "../query/cart"
import { cartQueryKey } from "../query/cart"

type UpdateQuantityInput = {
  lineItemId: string
  quantity: number
}

type RemoveItemInput = {
  lineItemId: string
}

type CartMutationContext = {
  previousCart: StoreCart
}

const applyQuantityUpdate = (cart: StoreCart, { lineItemId, quantity }: UpdateQuantityInput): StoreCart => {
  if (!cart) {
    return cart
  }

  return {
    ...cart,
    items: cart.items?.map((item) =>
      item.id === lineItemId ? { ...item, quantity } : item
    ) ?? [],
  }
}

const applyRemoveUpdate = (cart: StoreCart, { lineItemId }: RemoveItemInput): StoreCart => {
  if (!cart) {
    return cart
  }

  return {
    ...cart,
    items: cart.items?.filter((item) => item.id !== lineItemId) ?? [],
  }
}

export const useUpdateCartItemQuantityMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ lineItemId, quantity }: UpdateQuantityInput) =>
      updateCartItemQuantity(lineItemId, quantity),
    onMutate: async (variables): Promise<CartMutationContext> => {
      await queryClient.cancelQueries({ queryKey: cartQueryKey() })
      const previousCart = queryClient.getQueryData<StoreCart>(cartQueryKey())
      queryClient.setQueryData(cartQueryKey(), (current: StoreCart) =>
        applyQuantityUpdate(current, variables)
      )
      return { previousCart: previousCart ?? null }
    },
    onError: (error, _variables, context) => {
      if (context?.previousCart !== undefined) {
        queryClient.setQueryData(cartQueryKey(), context.previousCart)
      }
      safeLogError("Failed to update cart item quantity", error)
      toast.error("Failed to update quantity. Please try again.")
    },
    onSuccess: (cart) => {
      queryClient.setQueryData(cartQueryKey(), cart)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKey(), refetchType: "active" })
    },
  })
}

export const useRemoveCartItemMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ lineItemId }: RemoveItemInput) => removeCartItem(lineItemId),
    onMutate: async (variables): Promise<CartMutationContext> => {
      await queryClient.cancelQueries({ queryKey: cartQueryKey() })
      const previousCart = queryClient.getQueryData<StoreCart>(cartQueryKey())
      queryClient.setQueryData(cartQueryKey(), (current: StoreCart) =>
        applyRemoveUpdate(current, variables)
      )
      return { previousCart: previousCart ?? null }
    },
    onError: (error, _variables, context) => {
      if (context?.previousCart !== undefined) {
        queryClient.setQueryData(cartQueryKey(), context.previousCart)
      }
      safeLogError("Failed to remove cart item", error)
      toast.error("Failed to remove item. Please try again.")
    },
    onSuccess: (cart) => {
      queryClient.setQueryData(cartQueryKey(), cart)
      toast.success("Removed from cart")
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKey(), refetchType: "active" })
    },
  })
}
