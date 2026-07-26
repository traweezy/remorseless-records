import "server-only"

import { z } from "zod"

import { clientEnv } from "@/config/env.client"
import { checkoutServerEnv } from "@/config/env.checkout.server"
import { createCheckoutTaxLinkProof } from "@/features/checkout/server/internal-status-auth"

const TAX_LINK_TIMEOUT_MS = 10_000

const responseSchema = z
  .object({
    generation: z.number().int().positive(),
    linked: z.literal(true),
    provider: z.enum(["stripe_tax", "taxrate_io"]),
    replayed: z.boolean(),
  })
  .strict()

export class CheckoutTaxLinkError extends Error {
  constructor(message = "Checkout tax binding is temporarily unavailable") {
    super(message)
    this.name = "CheckoutTaxLinkError"
  }
}

export const linkCheckoutTax = async (cartId: string): Promise<void> => {
  const secret = checkoutServerEnv.checkoutBffSecret
  if (!secret) {
    throw new CheckoutTaxLinkError("Checkout tax binding is not configured")
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const proof = createCheckoutTaxLinkProof({ cartId, timestamp, secret })
  const baseUrl = checkoutServerEnv.medusaBackendUrl ?? clientEnv.medusaUrl

  let response: Response
  try {
    response = await fetch(new URL("/store/checkout/tax-link", baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-publishable-api-key": clientEnv.medusaPublishableKey,
        "x-rr-checkout-proof": proof,
        "x-rr-checkout-timestamp": String(timestamp),
      },
      body: JSON.stringify({ cart_id: cartId }),
      cache: "no-store",
      signal: AbortSignal.timeout(TAX_LINK_TIMEOUT_MS),
    })
  } catch {
    throw new CheckoutTaxLinkError()
  }

  if (!response.ok) {
    throw new CheckoutTaxLinkError()
  }

  const parsed = responseSchema.safeParse(
    await response.json().catch(() => null)
  )
  if (!parsed.success) {
    throw new CheckoutTaxLinkError("Checkout tax binding response was invalid")
  }
}
