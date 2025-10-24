"use server"

import { headers, cookies } from "next/headers"
import { redirect } from "next/navigation"

import { runtimeEnv } from "@/config/env"

const SESSION_ENDPOINT = "/store/checkout/stripe-session"

export const startStripeCheckout = async (cartId: string): Promise<void> => {
  if (!cartId) {
    throw new Error("Cart id is required to start checkout")
  }

  const headersList = await headers()
  const origin = headersList.get("origin") ?? runtimeEnv.medusaUrl

  const successUrl = `${origin}/order/confirmed`
  const cancelUrl = `${origin}/cart`

  const cookiesList = await cookies()
  const cookieHeader = cookiesList
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")

  const sessionUrl = new URL(SESSION_ENDPOINT, runtimeEnv.medusaBackendUrl)

  const response = await fetch(sessionUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      cart_id: cartId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(
      `Failed to create Stripe Checkout session (${response.status}): ${message}`
    )
  }

  const payload = (await response.json()) as { url?: string }

  if (!payload.url) {
    throw new Error("Stripe Checkout session did not return a redirect URL")
  }

  redirect(payload.url)
}
