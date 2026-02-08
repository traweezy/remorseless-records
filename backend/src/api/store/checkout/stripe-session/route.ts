import type Stripe from "stripe"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import type { ICartModuleService } from "@medusajs/framework/types"
import { z } from "zod"

import { getStripeClient } from "../../../../lib/stripe"
import { mergeMetadata } from "../../../../lib/metadata"
import { STORE_CORS } from "../../../../lib/constants"

const payloadSchema = z.object({
  cart_id: z.string().min(1, "cart_id is required"),
  success_url: z.string().url("success_url must be a valid URL"),
  cancel_url: z.string().url("cancel_url must be a valid URL"),
}).strict()

const allowedRedirectHosts = new Set(
  STORE_CORS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).host.toLowerCase()
      } catch {
        return ""
      }
    })
    .filter(Boolean)
)

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const body = payloadSchema.safeParse(req.body)

  if (!body.success) {
    const message = body.error.issues
      .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
      .join("; ")

    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      message || "Invalid payload"
    )
  }

  const {
    cart_id: cartId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  } = body.data

  if (!isAllowedRedirectUrl(successUrl) || !isAllowedRedirectUrl(cancelUrl)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "success_url and cancel_url must match an allowed storefront origin"
    )
  }

  const cartModuleService = req.scope.resolve<ICartModuleService>(Modules.CART)

  const cart = await cartModuleService.retrieveCart(cartId, {
    relations: ["items", "shipping_methods"],
  })

  if (!cart.items?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cart ${cartId} has no items`
    )
  }

  const currency = cart.currency_code?.toLowerCase()
  if (!currency) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Cart ${cartId} is missing currency_code`
    )
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    cart.items?.map((item) => {
      const unitPrice = Number(item.unit_price ?? 0)
      const quantity = Number(item.quantity ?? 0)

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Line item ${item.id} is missing a valid unit_price`
        )
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Line item ${item.id} is missing a valid quantity`
        )
      }

      return {
        price_data: {
          currency,
          unit_amount: Math.round(unitPrice),
          product_data: {
            name: item.title ?? "Item",
            metadata: {
              cart_line_item_id: item.id,
            },
          },
        },
        quantity: Math.round(quantity),
      }
    }) ?? []

  const shippingTotal = Number(cart.shipping_total ?? 0)
  if (Number.isFinite(shippingTotal) && shippingTotal > 0) {
    lineItems.push({
      price_data: {
        currency,
        unit_amount: Math.round(shippingTotal),
        product_data: {
          name: "Shipping",
          metadata: {
            cart_line_item_id: "shipping",
          },
        },
      },
      quantity: 1,
    })
  }

  if (!lineItems.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Unable to build Stripe line items for cart ${cartId}`
    )
  }

  const stripe = getStripeClient()

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    client_reference_id: cart.id,
    success_url: appendSessionPlaceholder(successUrl),
    cancel_url: cancelUrl,
    line_items: lineItems,
    automatic_tax: { enabled: true },
    metadata: {
      cart_id: cart.id,
    },
    payment_intent_data: {
      metadata: {
        cart_id: cart.id,
      },
    },
  }

  if (cart.email) {
    sessionParams.customer_email = cart.email
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  await cartModuleService.updateCarts(cart.id, {
    metadata: mergeMetadata(cart.metadata, {
      stripe_checkout_session_id: session.id,
    }),
  })

  res.status(200).json({
    id: session.id,
    url: session.url,
  })
}

const appendSessionPlaceholder = (url: string): string =>
  url.includes("{CHECKOUT_SESSION_ID}")
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`

const isAllowedRedirectUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return allowedRedirectHosts.has(url.host.toLowerCase())
  } catch {
    return false
  }
}
