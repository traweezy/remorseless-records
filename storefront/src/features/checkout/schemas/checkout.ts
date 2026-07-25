import { z } from "zod"

const US_SUBDIVISIONS = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
])

const trimmedRequired = (maximum: number) =>
  z.string().trim().min(1).max(maximum)

const optionalTrimmed = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => (value?.length ? value : undefined))

export const checkoutContactSchema = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict()

export const checkoutAddressSchema = z
  .object({
    first_name: trimmedRequired(120),
    last_name: trimmedRequired(120),
    address_1: trimmedRequired(255),
    address_2: optionalTrimmed(255),
    city: trimmedRequired(120),
    province: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => US_SUBDIVISIONS.has(value), {
        message: "Select a valid US state.",
      }),
    postal_code: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid US ZIP code."),
    country_code: z
      .string()
      .trim()
      .transform((value) => value.toLowerCase())
      .pipe(z.literal("us"))
      .default("us"),
    phone: optionalTrimmed(40),
  })
  .strict()

export const checkoutDeliverySchema = z
  .object({
    shipping_address: checkoutAddressSchema,
    billing_address: checkoutAddressSchema.optional(),
  })
  .strict()

export const checkoutShippingMethodSchema = z
  .object({
    option_id: z.string().trim().min(1).max(255),
  })
  .strict()

export const checkoutRevisionSchema = z
  .object({
    revision: z.string().regex(/^v1\.[A-Za-z0-9_-]{43}$/),
  })
  .strict()

export type CheckoutContactInput = z.infer<typeof checkoutContactSchema>
export type CheckoutAddressInput = z.infer<typeof checkoutAddressSchema>
export type CheckoutDeliveryInput = z.infer<typeof checkoutDeliverySchema>
