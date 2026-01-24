import type { HttpTypes } from "@medusajs/types"

import type { StoreCartAddressInput } from "@/lib/cart/types"

type StoreCart = HttpTypes.StoreCart

type CartResponse = { cart: StoreCart }

type ErrorResponse = { error?: string }

type PaymentSessionResponse = {
  payment_collection: HttpTypes.StorePaymentCollection
  payment_session: HttpTypes.StorePaymentSession | null
  client_secret: string | null
  provider_id: string
}

const requestJson = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorResponse
    const message = payload.error ?? `Request failed (${response.status})`
    const error = new Error(message)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }

  return response.json() as Promise<T>
}

export const createCart = async (regionId?: string): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>("/api/cart", {
    method: "POST",
    body: JSON.stringify(regionId ? { region_id: regionId } : {}),
  })

  return payload.cart
}

export const getCart = async (cartId: string): Promise<StoreCart | null> => {
  const response = await fetch(`/api/cart/${cartId}`, {
    method: "GET",
    cache: "no-store",
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorResponse
    const message = payload.error ?? `Request failed (${response.status})`
    const error = new Error(message)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }

  const payload = (await response.json()) as CartResponse
  return payload.cart
}

export const addLineItem = async (
  cartId: string,
  variantId: string,
  quantity: number
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(`/api/cart/${cartId}/items`, {
    method: "POST",
    body: JSON.stringify({ variant_id: variantId, quantity }),
  })

  return payload.cart
}

export const updateLineItem = async (
  cartId: string,
  lineItemId: string,
  quantity: number
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/${cartId}/items/${lineItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    }
  )

  return payload.cart
}

export const removeLineItem = async (
  cartId: string,
  lineItemId: string
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/${cartId}/items/${lineItemId}`,
    { method: "DELETE" }
  )

  return payload.cart
}

export const setEmail = async (
  cartId: string,
  email: string
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(`/api/cart/${cartId}/email`, {
    method: "POST",
    body: JSON.stringify({ email }),
  })

  return payload.cart
}

export const setAddresses = async (
  cartId: string,
  addresses: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  }
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/${cartId}/addresses`,
    {
      method: "POST",
      body: JSON.stringify(addresses),
    }
  )

  return payload.cart
}

export const listShippingOptions = async (
  cartId: string
): Promise<HttpTypes.StoreCartShippingOptionWithServiceZone[]> => {
  const payload = await requestJson<{
    shipping_options: HttpTypes.StoreCartShippingOptionWithServiceZone[]
  }>(`/api/cart/${cartId}/shipping-options`, { method: "GET" })

  return payload.shipping_options
}

export const addShippingMethod = async (
  cartId: string,
  optionId: string
): Promise<StoreCart> => {
  const payload = await requestJson<CartResponse>(
    `/api/cart/${cartId}/shipping-methods`,
    {
      method: "POST",
      body: JSON.stringify({ option_id: optionId }),
    }
  )

  return payload.cart
}

export const initPaymentSessions = async (
  cartId: string,
  providerId?: string
): Promise<PaymentSessionResponse> =>
  requestJson<PaymentSessionResponse>(`/api/cart/${cartId}/payment-sessions`, {
    method: "POST",
    body: JSON.stringify(providerId ? { provider_id: providerId } : {}),
  })

export const completeCart = async (
  cartId: string
): Promise<HttpTypes.StoreCompleteCartResponse> =>
  requestJson<HttpTypes.StoreCompleteCartResponse>(`/api/cart/${cartId}/complete`, {
    method: "POST",
  })
