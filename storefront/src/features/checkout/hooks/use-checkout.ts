"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"

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
import type { CheckoutProjection } from "@/features/checkout/types/checkout"

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

  const cancelCheckoutReads = useCallback(
    () =>
      Promise.all([
        queryClient.cancelQueries({ queryKey: CHECKOUT_QUERY_KEY }),
        queryClient.cancelQueries({
          queryKey: CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY,
        }),
      ]),
    [queryClient]
  )

  const setCheckout = useCallback(
    async (checkout: CheckoutProjection | null): Promise<void> => {
      // Focus/reconnect can start another read during a write. Cancel again
      // before publishing its authoritative projection, not only at onMutate.
      await cancelCheckoutReads()
      queryClient.setQueryData<CheckoutProjection | null>(
        CHECKOUT_QUERY_KEY,
        (current) =>
          checkout ? preservePreparedPayment(current, checkout) : null
      )
    },
    [cancelCheckoutReads, queryClient]
  )

  const applyProblemProjection = useCallback(
    async (error: unknown): Promise<void> => {
      if (
        error instanceof CheckoutApiError &&
        error.problem.checkout !== undefined
      ) {
        await setCheckout(error.problem.checkout)
      }
    },
    [setCheckout]
  )

  const resumeShippingReads = useCallback((): void => {
    void queryClient.invalidateQueries(
      { queryKey: CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY },
      { cancelRefetch: false }
    )
  }, [queryClient])

  const checkoutMutationOptions = useMemo(
    () => ({
      ...mutationOptions,
      onMutate: cancelCheckoutReads,
      onSettled: resumeShippingReads,
    }),
    [cancelCheckoutReads, resumeShippingReads]
  )

  const checkoutQuery = useQuery({
    queryKey: CHECKOUT_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const checkout = await getCheckout({ signal })
      return preservePreparedPayment(
        queryClient.getQueryData<CheckoutProjection | null>(CHECKOUT_QUERY_KEY),
        checkout
      )
    },
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
    ...checkoutMutationOptions,
    mutationKey: ["checkout", "contact"],
    mutationFn: (payload: CheckoutContactPayload) =>
      saveCheckoutContact(payload),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const deliveryMutation = useMutation({
    ...checkoutMutationOptions,
    mutationKey: ["checkout", "delivery"],
    mutationFn: (payload: CheckoutDeliveryPayload) =>
      saveCheckoutDelivery(payload),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const shippingOptionsQuery = useQuery({
    queryKey: [
      ...CHECKOUT_SHIPPING_OPTIONS_QUERY_KEY,
      checkoutQuery.data?.revision ?? null,
    ],
    queryFn: ({ signal }) => getCheckoutShippingOptions({ signal }),
    enabled: Boolean(checkoutQuery.data?.cart.deliveryAddress),
    staleTime: 0,
    retry: 1,
    meta: { persist: false },
  })

  const shippingMutation = useMutation({
    ...checkoutMutationOptions,
    mutationKey: ["checkout", "shipping-method"],
    mutationFn: (optionId: string) => saveCheckoutShippingMethod(optionId),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const paymentMutation = useMutation({
    ...checkoutMutationOptions,
    mutationKey: ["checkout", "payment-session"],
    mutationFn: (revision: string) => prepareCheckoutPayment(revision),
    onSuccess: setCheckout,
    onError: applyProblemProjection,
  })

  const completionMutation = useMutation({
    ...checkoutMutationOptions,
    mutationKey: ["checkout", "complete"],
    mutationFn: (revision: string) => completeCheckout(revision),
    onSuccess: cancelCheckoutReads,
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
    shippingOptions: shippingOptionsQuery.data ?? [],
    shippingOptionsError: shippingOptionsQuery.error,
    isLoadingShippingOptions: shippingOptionsQuery.isPending,
    refreshShippingOptions: shippingOptionsQuery.refetch,
    shippingMutation,
    paymentMutation,
    completionMutation,
  }
}
