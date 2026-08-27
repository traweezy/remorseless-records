import "server-only"

import { z } from "zod"

const checkoutServerSchema = z
  .object({
    MEDUSA_BACKEND_URL: z.string().url().optional(),
    CHECKOUT_BFF_SECRET: z.string().min(32).optional(),
    CHECKOUT_RECEIPT_SECRET: z.string().min(32).optional(),
    CHECKOUT_RECEIPT_SECRET_PREVIOUS: z.string().min(32).optional(),
  })
  .transform((value) => ({
    medusaBackendUrl: value.MEDUSA_BACKEND_URL ?? null,
    checkoutBffSecret: value.CHECKOUT_BFF_SECRET ?? null,
    checkoutReceiptSecret: value.CHECKOUT_RECEIPT_SECRET ?? null,
    checkoutReceiptSecretPrevious:
      value.CHECKOUT_RECEIPT_SECRET_PREVIOUS ?? null,
  }))

const parsed = checkoutServerSchema.safeParse({
  MEDUSA_BACKEND_URL: process.env.MEDUSA_BACKEND_URL,
  CHECKOUT_BFF_SECRET: process.env.CHECKOUT_BFF_SECRET,
  CHECKOUT_RECEIPT_SECRET: process.env.CHECKOUT_RECEIPT_SECRET,
  CHECKOUT_RECEIPT_SECRET_PREVIOUS:
    process.env.CHECKOUT_RECEIPT_SECRET_PREVIOUS,
})

if (!parsed.success) {
  console.error("❌ Invalid checkout server environment variables")
  console.error(z.flattenError(parsed.error).fieldErrors)
  throw new Error("Checkout server environment validation failed")
}

export const checkoutServerEnv = parsed.data
