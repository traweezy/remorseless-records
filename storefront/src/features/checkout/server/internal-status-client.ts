import "server-only"

import { z } from "zod"

import { clientEnv } from "@/config/env.client"
import { checkoutServerEnv } from "@/config/env.checkout.server"
import { createCheckoutStatusProof } from "@/features/checkout/server/internal-status-auth"

const CHECKOUT_STATUS_TIMEOUT_MS = 5_000

const statusSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.enum([
        "cart_active",
        "cart_missing",
        "finalizing_order",
        "payment_action_required",
        "payment_failed",
        "payment_processing",
      ]),
    })
    .strict(),
  z
    .object({
      state: z.literal("order_confirmed"),
      orderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
    })
    .strict(),
])

export type InternalCheckoutStatus = z.infer<typeof statusSchema>

export class CheckoutStatusUnavailableError extends Error {
  constructor(message = "Checkout status is temporarily unavailable") {
    super(message)
    this.name = "CheckoutStatusUnavailableError"
  }
}

export const fetchInternalCheckoutStatus = async (
  cartId: string
): Promise<InternalCheckoutStatus> => {
  const secret = checkoutServerEnv.checkoutBffSecret
  if (!secret) {
    throw new CheckoutStatusUnavailableError(
      "Checkout recovery is not configured"
    )
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const proof = createCheckoutStatusProof({ cartId, timestamp, secret })
  const baseUrl = checkoutServerEnv.medusaBackendUrl ?? clientEnv.medusaUrl

  let response: Response
  try {
    response = await fetch(new URL("/store/checkout/status", baseUrl), {
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
      signal: AbortSignal.timeout(CHECKOUT_STATUS_TIMEOUT_MS),
    })
  } catch {
    throw new CheckoutStatusUnavailableError()
  }

  if (!response.ok) {
    throw new CheckoutStatusUnavailableError()
  }

  const parsed = statusSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new CheckoutStatusUnavailableError(
      "Checkout status response was invalid"
    )
  }
  return parsed.data
}
