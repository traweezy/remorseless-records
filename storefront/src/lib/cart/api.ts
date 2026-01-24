import "server-only"

import type { HttpTypes } from "@medusajs/types"

import { siteMetadata } from "@/config/site"
import { medusa, storeClient } from "@/lib/medusa/client"
import type { StoreCartAddressInput } from "@/lib/cart/types"

const CART_FIELDS = [
  "id",
  "email",
  "currency_code",
  "subtotal",
  "total",
  "tax_total",
  "shipping_total",
  "discount_total",
  "*items",
  "*items.variant",
  "items.variant.calculated_price",
  "items.thumbnail",
  "*shipping_address",
  "*billing_address",
  "*shipping_methods",
  "shipping_methods.shipping_option_id",
  "shipping_methods.price",
  "*payment_collection",
  "*payment_collection.payment_sessions",
  "*region",
  "*region.countries",
].join(",")

let cachedRegionId: string | null = null

const resolvePreferredRegion = (
  regions: HttpTypes.StoreRegion[],
  preferredCountry: string | null
): HttpTypes.StoreRegion | undefined => {
  if (!regions.length) {
    return undefined
  }

  if (preferredCountry) {
    const normalized = preferredCountry.toLowerCase()
    const byCountry = regions.find((region) =>
      region.countries?.some(
        (country) => country.iso_2?.toLowerCase() === normalized
      )
    )

    if (byCountry) {
      return byCountry
    }
  }

  return regions[0]
}

const resolveRegionId = async (): Promise<string> => {
  if (cachedRegionId) {
    return cachedRegionId
  }

  const { regions } = await storeClient.region.list({ limit: 100 })
  const preferredCountry = siteMetadata.contact.address.country ?? null
  const region = resolvePreferredRegion(regions ?? [], preferredCountry)

  if (!region?.id) {
    throw new Error("No regions configured in Medusa")
  }

  cachedRegionId = region.id
  return region.id
}

export const createCart = async (regionId?: string): Promise<HttpTypes.StoreCart> => {
  const resolvedRegionId = regionId ?? (await resolveRegionId())
  const { cart } = await storeClient.cart.create(
    { region_id: resolvedRegionId },
    { fields: CART_FIELDS }
  )
  return cart
}

export const getCart = async (cartId: string): Promise<HttpTypes.StoreCart> => {
  const { cart } = await storeClient.cart.retrieve(cartId, { fields: CART_FIELDS })
  return cart
}

export const addLineItem = async (
  cartId: string,
  variantId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await storeClient.cart.createLineItem(
    cartId,
    { variant_id: variantId, quantity },
    { fields: CART_FIELDS }
  )

  return cart
}

export const updateLineItem = async (
  cartId: string,
  lineItemId: string,
  quantity: number
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await storeClient.cart.updateLineItem(
    cartId,
    lineItemId,
    { quantity },
    { fields: CART_FIELDS }
  )

  return cart
}

export const removeLineItem = async (
  cartId: string,
  lineItemId: string
): Promise<HttpTypes.StoreCart> => {
  const response = await storeClient.cart.deleteLineItem(
    cartId,
    lineItemId,
    { fields: CART_FIELDS }
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
  const { cart } = await storeClient.cart.update(
    cartId,
    { email },
    { fields: CART_FIELDS }
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

  const { cart } = await storeClient.cart.update(cartId, payload, {
    fields: CART_FIELDS,
  })

  return cart
}

export const listShippingOptions = async (
  cartId: string
): Promise<HttpTypes.StoreShippingOptionListResponse> =>
  storeClient.fulfillment.listCartOptions({ cart_id: cartId })

export const addShippingMethod = async (
  cartId: string,
  optionId: string
): Promise<HttpTypes.StoreCart> => {
  const { cart } = await storeClient.cart.addShippingMethod(
    cartId,
    { option_id: optionId },
    { fields: CART_FIELDS }
  )

  return cart
}

export const calculateTaxes = async (
  cartId: string
): Promise<HttpTypes.StoreCart> => {
  const response = await medusa.client.fetch<{ cart: HttpTypes.StoreCart }>(
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

  const { payment_providers } = await storeClient.payment.listPaymentProviders({
    region_id: regionId,
  })

  const resolvedProvider =
    payment_providers.find((provider) => provider.id === providerId) ??
    payment_providers.find((provider) => provider.id.includes("stripe"))

  if (!resolvedProvider) {
    throw new Error("No Stripe payment provider is configured for this region")
  }

  const { payment_collection } = await storeClient.payment.initiatePaymentSession(
    cart,
    {
      provider_id: resolvedProvider.id,
    }
  )

  const paymentSession =
    payment_collection.payment_sessions?.find(
      (session) =>
        session.provider_id === resolvedProvider.id && session.status === "pending"
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
