import "server-only"

import type { FetchArgs } from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"

import { stripePaymentSessionData } from "@/lib/cart/stripe-payment-data"
import {
  cartAmount,
  cartEnvelopeFrom,
  cartSnapshotFrom,
} from "@/lib/cart/snapshot"
import type { StoreCartAddressInput } from "@/lib/cart/types"
import { createUpstreamHeaders } from "@/lib/http/correlation"
import { medusa } from "@/lib/medusa/client"
import { correlatedMedusaFetch } from "@/lib/medusa/correlated-client"
import { fetchMedusaStoreRead } from "@/lib/medusa/read-client"
import {
  asUnknownRecord,
  readBoundedText,
  readNonNegativeSafeInteger,
  readRecordArray,
} from "@/lib/provider-boundary"
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
  "item_subtotal",
  "total",
  "tax_total",
  "shipping_total",
  "shipping_subtotal",
  "shipping_tax_total",
  "discount_total",
  "discount_subtotal",
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
const CART_COMPLETION_TIMEOUT_MS = 20_000
const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

type CartReadInit = Omit<FetchArgs, "body" | "method" | "signal">
type CartMutationInit = Omit<FetchArgs, "method" | "signal"> & {
  method: "DELETE" | "PATCH" | "POST" | "PUT"
}
export type StorefrontShippingOption = {
  amount: number
  description: string | null
  id: string
  insufficient_inventory: boolean
  name: string
  price_type: "calculated" | "flat_rate"
}
export type StorefrontShippingOptionListResponse = {
  shipping_options: StorefrontShippingOption[]
}
type ShippingOptionCandidate = Omit<StorefrontShippingOption, "amount"> & {
  amount: number | null
}
type ShippingOptionCandidateList = {
  shipping_options: ShippingOptionCandidate[]
}

const requiredCartFromEnvelope = (value: unknown): HttpTypes.StoreCart => {
  const { cart } = cartEnvelopeFrom(value)
  if (!cart) {
    throw new Error("The Medusa cart response is missing.")
  }
  return cart
}

const shippingOptionListFrom = (
  value: unknown
): ShippingOptionCandidateList => {
  const response = asUnknownRecord(value)
  const options = readRecordArray(response?.shipping_options)
  const count = readNonNegativeSafeInteger(response?.count)
  const limit = readNonNegativeSafeInteger(response?.limit)
  const offset = readNonNegativeSafeInteger(response?.offset)
  if (
    !response ||
    !options ||
    options.length > 50 ||
    count === null ||
    count < options.length ||
    limit === null ||
    limit < options.length ||
    limit > 50 ||
    offset === null
  ) {
    throw new Error("The Medusa shipping-option response is malformed.")
  }
  const optionIds = new Set<string>()
  const shippingOptions = options.map((option) => {
    const id = readBoundedText(option.id)
    const name = readBoundedText(option.name, 255)
    const priceType = readBoundedText(option.price_type, 32)
    const amount = cartAmount(option.amount)
    const insufficientInventory = option.insufficient_inventory
    const optionType = asUnknownRecord(option.type)
    const description =
      option.type === null || option.type === undefined
        ? null
        : readBoundedText(optionType?.description, 1_000)
    if (
      !id ||
      !/^so_[A-Za-z0-9]+$/.test(id) ||
      !name ||
      optionIds.has(id) ||
      (priceType !== "calculated" && priceType !== "flat_rate") ||
      (priceType === "flat_rate" && amount === null) ||
      (insufficientInventory !== null &&
        insufficientInventory !== undefined &&
        typeof insufficientInventory !== "boolean") ||
      (option.type !== null &&
        option.type !== undefined &&
        (!optionType ||
          (optionType.description !== null &&
            optionType.description !== undefined &&
            !description)))
    ) {
      throw new Error("A Medusa shipping option is malformed.")
    }
    const normalizedPriceType: StorefrontShippingOption["price_type"] =
      priceType === "calculated" ? "calculated" : "flat_rate"
    optionIds.add(id)
    return {
      amount,
      description,
      id,
      insufficient_inventory: insufficientInventory === true,
      name,
      price_type: normalizedPriceType,
    }
  })
  return { shipping_options: shippingOptions }
}

const calculatedShippingAmountFrom = (
  value: unknown,
  expectedOptionId: string
): number => {
  const response = asUnknownRecord(value)
  const option = asUnknownRecord(response?.shipping_option)
  const amount = cartAmount(option?.amount)
  if (readBoundedText(option?.id) !== expectedOptionId || amount === null) {
    throw new Error("The calculated Medusa shipping price is malformed.")
  }
  return amount
}

const cartReadRequest = <T>(
  path: string,
  init: CartReadInit,
  request?: Request
): Promise<T> => {
  const readInit = { ...init, method: "GET" as const }
  return request
    ? correlatedMedusaFetch<T>(request, path, readInit)
    : fetchMedusaStoreRead<T>(path, readInit)
}

const cartMutationRequest = <T>(
  path: string,
  init: CartMutationInit,
  timeoutMs = CART_UPSTREAM_TIMEOUT_MS,
  request?: Request
): Promise<T> => {
  const headers = request
    ? Object.fromEntries(
        createUpstreamHeaders(request, init.headers as HeadersInit).entries()
      )
    : init.headers
  return medusa.client.fetch<T>(path, {
    ...init,
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

export const createCart = async (
  regionId?: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const resolvedRegionId = regionId ?? (await resolveRegionId(request))
  const response = await cartMutationRequest<unknown>(
    "/store/carts",
    {
      method: "POST",
      body: { region_id: resolvedRegionId },
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )
  return requiredCartFromEnvelope(response)
}

export const getCart = async (
  cartId: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartReadRequest<unknown>(
    `/store/carts/${cartId}`,
    { query: { fields: CART_FIELDS } },
    request
  )
  return requiredCartFromEnvelope(response)
}

export const addLineItem = async (
  cartId: string,
  variantId: string,
  quantity: number,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}/line-items`,
    {
      method: "POST",
      body: { variant_id: variantId, quantity },
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
}

export const updateLineItem = async (
  cartId: string,
  lineItemId: string,
  quantity: number,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "POST",
      body: { quantity },
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
}

export const removeLineItem = async (
  cartId: string,
  lineItemId: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "DELETE",
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )
  const parent = asUnknownRecord(response)?.parent
  return cartSnapshotFrom(parent)
}

export const setCartEmail = async (
  cartId: string,
  email: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}`,
    {
      method: "POST",
      body: { email },
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
}

export const setCartAddresses = async (
  cartId: string,
  addresses: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  },
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const payload: {
    shipping_address: StoreCartAddressInput
    billing_address?: StoreCartAddressInput
  } = { shipping_address: addresses.shipping_address }

  if (addresses.billing_address) {
    payload.billing_address = addresses.billing_address
  }

  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}`,
    {
      method: "POST",
      body: payload,
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
}

export const listShippingOptions = async (
  cartId: string,
  request?: Request
): Promise<StorefrontShippingOptionListResponse> => {
  const response = shippingOptionListFrom(
    await cartReadRequest<unknown>(
      "/store/shipping-options",
      { query: { cart_id: cartId } },
      request
    )
  )

  const resolved = await Promise.allSettled(
    (response.shipping_options ?? []).map(async (option) => {
      if (option.price_type !== "calculated") {
        if (option.amount === null) {
          throw new Error("A Medusa shipping option is malformed.")
        }
        return { ...option, amount: option.amount }
      }

      const amount = calculatedShippingAmountFrom(
        await cartMutationRequest<unknown>(
          `/store/shipping-options/${option.id}/calculate`,
          {
            method: "POST",
            body: { cart_id: cartId, data: {} },
          },
          CART_UPSTREAM_TIMEOUT_MS,
          request
        ),
        option.id
      )

      return {
        ...option,
        amount,
      }
    })
  )
  const failures = resolved.filter((result) => result.status === "rejected")
  if (failures.length) {
    console.warn(
      `Shipping price calculation failed for ${failures.length} option(s).`
    )
  }

  return {
    ...response,
    shipping_options: resolved.flatMap((result) => {
      if (result.status !== "fulfilled") {
        return []
      }
      return [result.value]
    }),
  }
}

export const addShippingMethod = async (
  cartId: string,
  optionId: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}/shipping-methods`,
    {
      method: "POST",
      body: { option_id: optionId },
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
}

export const calculateTaxes = async (
  cartId: string,
  request?: Request
): Promise<HttpTypes.StoreCart> => {
  const response = await cartMutationRequest<unknown>(
    `/store/carts/${cartId}/taxes`,
    {
      method: "POST",
      query: { fields: CART_FIELDS },
    },
    CART_UPSTREAM_TIMEOUT_MS,
    request
  )

  return requiredCartFromEnvelope(response)
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
  cartOverride?: HttpTypes.StoreCart,
  request?: Request
): Promise<{
  payment_collection: HttpTypes.StorePaymentCollection
  payment_session: HttpTypes.StorePaymentSession | null
  client_secret: string | null
  provider_id: string
}> => {
  const cart = cartOverride ?? (await getCart(cartId, request))
  const regionId = cart.region_id ?? cart.region?.id

  if (!regionId) {
    throw new Error("Cart region is required to initialize payment")
  }

  const { payment_providers } =
    await cartReadRequest<HttpTypes.StorePaymentProviderListResponse>(
      "/store/payment-providers",
      {
        query: { region_id: regionId },
      },
      request
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
      await cartMutationRequest<HttpTypes.StorePaymentCollectionResponse>(
        "/store/payment-collections",
        {
          method: "POST",
          body: { cart_id: cartId },
        },
        CART_UPSTREAM_TIMEOUT_MS,
        request
      )
    paymentCollectionId = payment_collection.id
  }

  const { payment_collection } =
    await cartMutationRequest<HttpTypes.StorePaymentCollectionResponse>(
      `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
      {
        method: "POST",
        body: {
          provider_id: resolvedProvider.id,
          data: stripePaymentSessionData(cart),
        },
      },
      CART_UPSTREAM_TIMEOUT_MS,
      request
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
  cartId: string,
  request?: Request
): Promise<HttpTypes.StoreCompleteCartResponse> =>
  cartMutationRequest<HttpTypes.StoreCompleteCartResponse>(
    `/store/carts/${cartId}/complete`,
    { method: "POST" },
    CART_COMPLETION_TIMEOUT_MS,
    request
  )
