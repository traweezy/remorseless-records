import "server-only"

import type { HttpTypes } from "@medusajs/types"

import { medusa, storeClient } from "@/lib/medusa/client"
import type { StoreCartAddressInput } from "@/lib/cart/types"
import { resolveRegionId } from "@/lib/regions"

const CART_FIELDS = [
  "id",
  "email",
  "customer_id",
  "completed_at",
  "created_at",
  "updated_at",
  "currency_code",
  "subtotal",
  "total",
  "tax_total",
  "shipping_total",
  "shipping_subtotal",
  "shipping_tax_total",
  "discount_total",
  "*items",
  "*items.tax_lines",
  "*items.adjustments",
  "*items.variant",
  "items.variant.inventory_quantity",
  "items.variant.calculated_price",
  "items.product.id",
  "items.product.handle",
  "items.product.metadata",
  "items.thumbnail",
  "*shipping_address",
  "*billing_address",
  "*shipping_methods",
  "*shipping_methods.tax_lines",
  "*shipping_methods.adjustments",
  "shipping_methods.shipping_option_id",
  "shipping_methods.price",
  "*payment_collection",
  "*payment_collection.payment_sessions",
  "*region",
  "*region.countries",
].join(",")

const CART_UPSTREAM_TIMEOUT_MS = 8_000
const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

const cartRequest = <T>(
  path: string,
  init?: Omit<Parameters<typeof medusa.client.fetch<T>>[1], "signal">
): Promise<T> =>
  medusa.client.fetch<T>(path, {
    ...init,
    signal: AbortSignal.timeout(CART_UPSTREAM_TIMEOUT_MS),
  })

export const createCart = async (
  regionId?: string
): Promise<HttpTypes.StoreCart> => {
  const resolvedRegionId = regionId ?? (await resolveRegionId())
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    "/store/carts",
    {
      method: "POST",
      body: { region_id: resolvedRegionId },
      query: { fields: CART_FIELDS },
    }
  )
  return cart
}

export const getCart = async (cartId: string): Promise<HttpTypes.StoreCart> => {
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}`,
    { query: { fields: CART_FIELDS } }
  )
  return cart
}

export const addLineItem = async (
  cartId: string,
  variantId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}/line-items`,
    {
      method: "POST",
      body: { variant_id: variantId, quantity },
      query: { fields: CART_FIELDS },
    }
  )

  return cart
}

export const updateLineItem = async (
  cartId: string,
  lineItemId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "POST",
      body: { quantity },
      query: { fields: CART_FIELDS },
    }
  )

  return cart
}

export const removeLineItem = async (
  cartId: string,
  lineItemId: string
): Promise<HttpTypes.StoreCart> => {
  const response = await cartRequest<HttpTypes.StoreLineItemDeleteResponse>(
    `/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "DELETE",
      query: { fields: CART_FIELDS },
    }
  )

  const parent = response.parent
  if (!parent) {
    throw new Error("Cart response missing after removing line item")
  }

  return parent
}

export const setCartEmail = async (
  cartId: string,
  email: string
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}`,
    {
      method: "POST",
      body: { email },
      query: { fields: CART_FIELDS },
    }
  )

  return cart
}

export const setCartAddresses = async (
  cartId: string,
  addresses: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  }
): Promise<HttpTypes.StoreCart> => {
  const payload: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  } = { shipping_address: addresses.shipping_address }

  if (addresses.billing_address) {
    payload.billing_address = addresses.billing_address
  }

  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}`,
    {
      method: "POST",
      body: payload,
      query: { fields: CART_FIELDS },
    }
  )

  return cart
}

export const listShippingOptions = async (
  cartId: string
): Promise<HttpTypes.StoreShippingOptionListResponse> =>
  cartRequest<HttpTypes.StoreShippingOptionListResponse>(
    "/store/shipping-options",
    {
      query: { cart_id: cartId },
    }
  )

export const addShippingMethod = async (
  cartId: string,
  optionId: string
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await cartRequest<HttpTypes.StoreCartResponse>(
    `/store/carts/${cartId}/shipping-methods`,
    {
      method: "POST",
      body: { option_id: optionId },
      query: { fields: CART_FIELDS },
    }
  )

  return cart
}

export const calculateTaxes = async (
  cartId: string
): Promise<HttpTypes.StoreCart> => {
  const response = await cartRequest<{ cart: HttpTypes.StoreCart }>(
    `/store/carts/${cartId}/taxes`,
    {
      method: "POST",
      query: { fields: CART_FIELDS },
    }
  )

  return response.cart
}

const extractClientSecret = (
  session: HttpTypes.StorePaymentSession | undefined
): string | null => {
  if (!session?.data || typeof session.data !== "object") {
    return null
  }

  const data = session.data
  const clientSecret = data.client_secret
  return typeof clientSecret === "string" ? clientSecret : null
}

export const initiatePaymentSession = async (
  cartId: string,
  providerId?: string,
  cartOverride?: HttpTypes.StoreCart
): Promise<{
  payment_collection: HttpTypes.StorePaymentCollection
  payment_session: HttpTypes.StorePaymentSession | null
  client_secret: string | null
  provider_id: string
}> => {
  const cart = cartOverride ?? (await getCart(cartId))
  const regionId = cart.region_id ?? cart.region?.id

  if (!regionId) {
    throw new Error("Cart region is required to initialize payment")
  }

  const { payment_providers } =
    await cartRequest<HttpTypes.StorePaymentProviderListResponse>(
      "/store/payment-providers",
      {
        query: { region_id: regionId },
      }
    )

  const requestedProvider = providerId ?? STRIPE_PROVIDER_ID
  const resolvedProvider = payment_providers.find(
    (provider) => provider.id === requestedProvider
  )

  if (!resolvedProvider) {
    throw new Error("No Stripe payment provider is configured for this region")
  }

  let paymentCollectionId = cart.payment_collection?.id
  if (!paymentCollectionId) {
    const { payment_collection } =
      await cartRequest<HttpTypes.StorePaymentCollectionResponse>(
        "/store/payment-collections",
        {
          method: "POST",
          body: { cart_id: cartId },
        }
      )
    paymentCollectionId = payment_collection.id
  }

  const { payment_collection } =
    await cartRequest<HttpTypes.StorePaymentCollectionResponse>(
      `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
      {
        method: "POST",
        body: {
          provider_id: resolvedProvider.id,
        },
      }
    )

  const paymentSession =
    payment_collection.payment_sessions?.find(
      (session) =>
        session.provider_id === resolvedProvider.id &&
        session.status === "pending"
    ) ??
    payment_collection.payment_sessions?.find(
      (session) => session.provider_id === resolvedProvider.id
    )

  return {
    payment_collection,
    payment_session: paymentSession ?? null,
    client_secret: extractClientSecret(paymentSession),
    provider_id: resolvedProvider.id,
  }
}

export const completeCart = async (
  cartId: string
): Promise<HttpTypes.StoreCompleteCartResponse> =>
  storeClient.cart.complete(cartId)
