"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import {
  CheckoutApiError,
  completeCheckout,
  getCheckout,
  getCheckoutShippingOptions,
  prepareCheckoutPayment,
  saveCheckoutContact,
  saveCheckoutDelivery,
  saveCheckoutShippingMethod,
  type CheckoutContactPayload,
  type CheckoutDeliveryPayload,
} from "@/features/checkout/api/checkout-api"
import type {
  CheckoutProjection,
  CheckoutShippingOption,
} from "@/features/checkout/types/checkout"

export const CHECKOUT_QUERY_KEY = ["checkout", "active"] as const
export const CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY = [
  "checkout",
  "shipping-options",
] as const

const mutationOptions = {
  retry: false,
  scope: { id: "checkout" },
} as const

export const preservePreparedPayment = (
  current: CheckoutProjection | null | undefined,
  next: CheckoutProjection | null
): CheckoutProjection | null => {
  if (!next) {
    return null
  }
  if (
    next.payment.clientSecret ||
    !current?.payment.clientSecret ||
    current.revision !== next.revision ||
    current.payment.provider !== next.payment.provider ||
    current.payment.status !== next.payment.status
  ) {
    return next
  }

  return {
    ...next,
    payment: {
      ...next.payment,
      clientSecret: current.payment.clientSecret,
    },
  }
}

export const useCheckout = () => {
  const queryClient = useQueryClient()

  const setCheckout = useCallback(
    (checkout: CheckoutProjection | null): void => {
      queryClient.setQueryData<CheckoutProjection | null>(
        CHECKOUT_QUERY_KEY,
        (current) =>
          checkout ? preservePreparedPayment(current, checkout) : null
      )
    },
    [queryClient]
  )

  const applyProblemProjection = useCallback(
    (error: unknown): void => {
      if (
        error instanceof CheckoutApiError &&
        error.problem.checkout !== undefined
      ) {
        setCheckout(error.problem.checkout)
      }
    },
    [setCheckout]
  )

  const checkoutQuery = useQuery({
    queryKey: CHECKOUT_QUERY_KEY,
    queryFn: async () =>
      preservePreparedPayment(
        queryClient.getQueryData<CheckoutProjection | null>(
          CHECKOUT_QUERY_KEY
        ),
        await getCheckout()
      ),
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failureCount, error) =>
      failureCount < 2 &&
      !(
        error instanceof CheckoutApiError &&
        [404, 409].includes(error.problem.status)
      ),
    meta: { persist: false },
  })

  const contactMutation = useMutation({
    ...mutationOptions,
    mutationKey: ["checkout", "contact"],
    mutationFn: (payload: CheckoutContactPayload) =>
      saveCheckoutContact(payload),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const deliveryMutation = useMutation({
    ...mutationOptions,
    mutationKey: ["checkout", "delivery"],
    mutationFn: (payload: CheckoutDeliveryPayload) =>
      saveCheckoutDelivery(payload),
    onSuccess: async (checkout) => {
      setCheckout(checkout)
      queryClient.removeQueries({
        queryKey: CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY,
      })
      await queryClient.invalidateQueries({
        queryKey: CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY,
      })
    },
    onError: applyProblemProjection,
  })

  const shippingOptionsQuery = useQuery({
    queryKey: CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY,
    queryFn: getCheckoutShippingOptions,
    enabled: Boolean(checkoutQuery.data?.cart.deliveryAddress),
    staleTime: 0,
    retry: 1,
    meta: { persist: false },
  })

  const shippingMutation = useMutation({
    ...mutationOptions,
    mutationKey: ["checkout", "shipping-method"],
    mutationFn: (optionId: string) => saveCheckoutShippingMethod(optionId),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const paymentMutation = useMutation({
    ...mutationOptions,
    mutationKey: ["checkout", "payment-session"],
    mutationFn: (revision: string) => prepareCheckoutPayment(revision),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const completionMutation = useMutation({
    ...mutationOptions,
    mutationKey: ["checkout", "complete"],
    mutationFn: (revision: string) => completeCheckout(revision),
    onError: applyProblemProjection,
  })

  const refreshCheckout = useCallback(
    () => checkoutQuery.refetch(),
    [checkoutQuery]
  )

  return {
    checkout: checkoutQuery.data ?? null,
    checkoutError: checkoutQuery.error,
    isLoading: checkoutQuery.isPending,
    isRefreshing: checkoutQuery.isFetching,
    refreshCheckout,
    setCheckout,
    contactMutation,
    deliveryMutation,
    shippingOptions:
      (shippingOptionsQuery.data as CheckoutShippingOption[] | undefined) ?? [],
    shippingOptionsError: shippingOptionsQuery.error,
    isLoadingShippingOptions: shippingOptionsQuery.isPending,
    refreshShippingOptions: shippingOptionsQuery.refetch,
    shippingMutation,
    paymentMutation,
    completionMutation,
  }
}
