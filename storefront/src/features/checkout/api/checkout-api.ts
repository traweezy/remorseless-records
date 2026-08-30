import { z } from "zod"

import type {
  CheckoutAddress,
  CheckoutProblem,
  CheckoutProjection,
  CheckoutReceipt,
  CheckoutShippingOption,
} from "@/features/checkout/types/checkout"

const CHECKOUT_REQUEST_TIMEOUT_MS = 12_000
const CHECKOUT_COMPLETION_TIMEOUT_MS = 25_000

const checkoutStateSchema = z.enum([
  "needs_contact",
  "needs_address",
  "needs_shipping",
  "ready_for_payment",
  "payment_action_required",
  "payment_processing",
  "finalizing_order",
  "order_confirmed",
  "payment_failed",
  "recovery_required",
])

const checkoutItemSchema = z
  .object({
    availableQuantity: z.number().int().nonnegative().nullable(),
    id: z.string().min(1),
    productHandle: z.string().min(1).nullable(),
    productTitle: z.string().min(1),
    quantity: z.number().int().positive(),
    subtotal: z.number().finite().nonnegative(),
    thumbnail: z.string().min(1).nullable(),
    unitPrice: z.number().finite().nonnegative(),
    variantTitle: z.string().min(1).nullable(),
  })
  .strict()

const checkoutAddressSchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    address1: z.string().min(1),
    address2: z.string().min(1).nullable(),
    city: z.string().min(1),
    province: z.string().min(1),
    postalCode: z.string().min(1),
    countryCode: z.literal("us"),
    phone: z.string().min(1).nullable(),
  })
  .strict()

const checkoutShippingMethodSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    optionId: z.string().min(1),
    amount: z.number().finite().nonnegative(),
  })
  .strict()

const checkoutTotalsSchema = z
  .object({
    taxCollectionMode: z.enum(["collect", "disabled", "unknown"]),
    currencyCode: z.literal("usd"),
    subtotal: z.number().finite().nonnegative(),
    discountTotal: z.number().finite().nonnegative(),
    shippingTotal: z.number().finite().nonnegative(),
    taxTotal: z.number().finite().nonnegative(),
    total: z.number().finite().nonnegative(),
  })
  .strict()

const checkoutPaymentSchema = z
  .object({
    provider: z.literal("stripe").nullable(),
    clientSecret: z.string().min(1).nullable(),
    status: z.string().min(1).nullable(),
    canRestart: z.boolean(),
  })
  .strict()

const checkoutConfirmationSchema = z
  .object({
    orderNumber: z.string().min(1).nullable(),
  })
  .strict()

const checkoutProjectionSchema: z.ZodType<CheckoutProjection> = z
  .object({
    state: checkoutStateSchema,
    revision: z.string().regex(/^v1\.[A-Za-z0-9_-]{43}$/),
    cart: z
      .object({
        items: z.array(checkoutItemSchema).min(1),
        totals: checkoutTotalsSchema,
        contact: z.object({ email: z.string().email() }).strict().nullable(),
        deliveryAddress: checkoutAddressSchema.nullable(),
        shippingMethod: checkoutShippingMethodSchema.nullable(),
      })
      .strict(),
    payment: checkoutPaymentSchema,
    confirmation: checkoutConfirmationSchema.nullable(),
  })
  .strict()

const checkoutEnvelopeSchema = z
  .object({ checkout: checkoutProjectionSchema.nullable() })
  .strict()

const activeCheckoutEnvelopeSchema = z
  .object({ checkout: checkoutProjectionSchema })
  .strict()

const shippingOptionSchema: z.ZodType<CheckoutShippingOption> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1).nullable(),
    amount: z.number().finite().nonnegative(),
    currencyCode: z.literal("usd"),
    insufficientInventory: z.boolean(),
  })
  .strict()

const shippingOptionsEnvelopeSchema = z
  .object({ shippingOptions: z.array(shippingOptionSchema) })
  .strict()

const checkoutProblemCodeSchema = z.enum([
  "address_invalid",
  "cart_completed",
  "cart_empty",
  "cart_missing",
  "checkout_changed",
  "completion_in_progress",
  "contact_invalid",
  "cross_site_request",
  "invalid_origin",
  "invalid_referer",
  "invalid_request",
  "inventory_changed",
  "malformed_json",
  "order_finalizing",
  "payment_action_required",
  "payment_declined",
  "payment_not_configured",
  "payment_processing",
  "payment_result_unknown",
  "payment_session_stale",
  "payload_too_large",
  "rate_limited",
  "recovery_required",
  "request_source_required",
  "shipping_changed",
  "shipping_unavailable",
  "tax_unavailable",
  "unsupported_media_type",
])

const checkoutProblemSchema: z.ZodType<CheckoutProblem> = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1),
    code: checkoutProblemCodeSchema,
    instance: z.string().min(1).optional(),
    request_id: z.string().min(1).max(128).optional(),
    trace_id: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    checkout: checkoutProjectionSchema.optional(),
  })
  .passthrough()

const checkoutCompletionSchema = z
  .object({
    checkout: z
      .object({
        state: z.literal("order_confirmed"),
        confirmation: checkoutConfirmationSchema,
      })
      .strict(),
  })
  .strict()

const checkoutStatusSchema = z
  .object({
    checkout: z
      .object({
        state: z.enum([
          "cart_active",
          "cart_missing",
          "payment_action_required",
          "payment_processing",
          "finalizing_order",
          "order_confirmed",
          "payment_failed",
        ]),
      })
      .strict(),
  })
  .strict()

const checkoutReceiptSchema: z.ZodType<CheckoutReceipt> = z
  .object({
    orderNumber: z.string().min(1).nullable(),
    placedAt: z.string().datetime(),
    email: z.string().email(),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          variantTitle: z.string().min(1).nullable(),
          thumbnail: z.string().min(1).nullable(),
          quantity: z.number().int().positive(),
          total: z.number().finite().nonnegative(),
        })
        .strict()
    ),
    deliveryAddress: z
      .object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        address1: z.string().min(1),
        address2: z.string().min(1).nullable(),
        city: z.string().min(1),
        province: z.string().min(1),
        postalCode: z.string().min(1),
        countryCode: z.string().min(2),
      })
      .strict()
      .nullable(),
    deliveryMethod: z.string().min(1).nullable(),
    totals: checkoutTotalsSchema,
  })
  .strict()

const checkoutReceiptEnvelopeSchema = z
  .object({ receipt: checkoutReceiptSchema })
  .strict()

export type CheckoutContactPayload = {
  email: string
}

export type CheckoutAddressPayload = {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string
  city: string
  province: string
  postal_code: string
  country_code: "us"
  phone?: string
}

export type CheckoutDeliveryPayload = {
  shipping_address: CheckoutAddressPayload
  billing_address?: CheckoutAddressPayload
}

export type CheckoutCompletion = z.infer<
  typeof checkoutCompletionSchema
>["checkout"]

export type CheckoutRecoveryState = z.infer<
  typeof checkoutStatusSchema
>["checkout"]["state"]

export class CheckoutApiError extends Error {
  readonly problem: CheckoutProblem

  constructor(problem: CheckoutProblem) {
    super(problem.detail)
    this.name = "CheckoutApiError"
    this.problem = problem
  }
}

const fallbackProblem = (
  path: string,
  status: number,
  detail: string
): CheckoutProblem => ({
  type: "https://remorselessrecords.com/problems/recovery-required",
  title: "Checkout is temporarily unavailable",
  status,
  detail,
  code: "recovery_required",
  instance: path,
})

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const request = async <TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  options: {
    method?: "GET" | "POST" | "PUT"
    body?: unknown
    timeoutMs?: number
  } = {}
): Promise<z.infer<TSchema>> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? CHECKOUT_REQUEST_TIMEOUT_MS
  )

  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json, application/problem+json",
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      signal: controller.signal,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    })
    const payload = await parseJson(response)

    if (!response.ok) {
      const parsedProblem = checkoutProblemSchema.safeParse(payload)
      throw new CheckoutApiError(
        parsedProblem.success
          ? parsedProblem.data
          : fallbackProblem(
              path,
              response.status,
              "We could not complete that checkout step. Try again."
            )
      )
    }

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      throw new CheckoutApiError(
        fallbackProblem(
          path,
          502,
          "Checkout returned an unexpected response. Try again."
        )
      )
    }
    return parsed.data
  } catch (error: unknown) {
    if (error instanceof CheckoutApiError) {
      throw error
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CheckoutApiError(
        fallbackProblem(
          path,
          504,
          "Checkout took too long to respond. Check your connection and try again."
        )
      )
    }
    throw new CheckoutApiError(
      fallbackProblem(
        path,
        503,
        "Checkout could not be reached. Check your connection and try again."
      )
    )
  } finally {
    window.clearTimeout(timeout)
  }
}

export const getCheckout = async (): Promise<CheckoutProjection | null> => {
  const response = await request("/api/checkout", checkoutEnvelopeSchema)
  return response.checkout
}

export const saveCheckoutContact = async (
  payload: CheckoutContactPayload
): Promise<CheckoutProjection> => {
  const response = await request(
    "/api/checkout/contact",
    activeCheckoutEnvelopeSchema,
    { method: "PUT", body: payload }
  )
  return response.checkout
}

export const saveCheckoutDelivery = async (
  payload: CheckoutDeliveryPayload
): Promise<CheckoutProjection> => {
  const response = await request(
    "/api/checkout/delivery-address",
    activeCheckoutEnvelopeSchema,
    { method: "PUT", body: payload }
  )
  return response.checkout
}

export const getCheckoutShippingOptions = async (): Promise<
  CheckoutShippingOption[]
> => {
  const response = await request(
    "/api/checkout/shipping-options",
    shippingOptionsEnvelopeSchema
  )
  return response.shippingOptions
}

export const saveCheckoutShippingMethod = async (
  optionId: string
): Promise<CheckoutProjection> => {
  const response = await request(
    "/api/checkout/shipping-method",
    activeCheckoutEnvelopeSchema,
    { method: "PUT", body: { option_id: optionId } }
  )
  return response.checkout
}

export const prepareCheckoutPayment = async (
  revision: string
): Promise<CheckoutProjection> => {
  const response = await request(
    "/api/checkout/payment-session",
    activeCheckoutEnvelopeSchema,
    { method: "POST", body: { revision } }
  )
  return response.checkout
}

export const completeCheckout = async (
  revision: string
): Promise<CheckoutCompletion> => {
  const response = await request(
    "/api/checkout/complete",
    checkoutCompletionSchema,
    {
      method: "POST",
      body: { revision },
      timeoutMs: CHECKOUT_COMPLETION_TIMEOUT_MS,
    }
  )
  return response.checkout
}

export const getCheckoutStatus = async (): Promise<CheckoutRecoveryState> => {
  const response = await request("/api/checkout/status", checkoutStatusSchema)
  return response.checkout.state
}

export const getCheckoutReceipt = async (): Promise<CheckoutReceipt> => {
  const response = await request(
    "/api/checkout/confirmation",
    checkoutReceiptEnvelopeSchema
  )
  return response.receipt
}

export const checkoutAddressFromProjection = (
  address: CheckoutAddress
): CheckoutAddressPayload => ({
  first_name: address.firstName,
  last_name: address.lastName,
  address_1: address.address1,
  ...(address.address2 ? { address_2: address.address2 } : {}),
  city: address.city,
  province: address.province,
  postal_code: address.postalCode,
  country_code: address.countryCode,
  ...(address.phone ? { phone: address.phone } : {}),
})
