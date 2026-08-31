import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  type CheckoutStatusQueryGraph,
  resolveInternalCheckoutStatus,
} from "../../../../lib/checkout/internal-status"
import { verifyCheckoutStatusProof } from "../../../../lib/checkout/internal-status-auth"
import { sendApiProblem } from "../../../../lib/http/correlation"

const bodySchema = z
  .object({
    cart_id: z.string().regex(/^cart_[A-Za-z0-9]+$/),
  })
  .strict()

const TIMESTAMP_HEADER = "x-rr-checkout-timestamp"
const PROOF_HEADER = "x-rr-checkout-proof"

const problem = (
  req: MedusaStoreRequest,
  res: MedusaResponse,
  input: {
    status: number
    code: string
    title: string
    detail: string
  }
): void => {
  res.setHeader("Cache-Control", "no-store")
  sendApiProblem(req, res, {
    ...input,
    instance: req.path,
  })
}

const header = (req: MedusaStoreRequest, name: string): string | undefined => {
  const value = req.headers[name]
  return typeof value === "string" ? value.trim() : undefined
}

export const POST = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    problem(req, res, {
      status: 400,
      code: "invalid_request",
      title: "Invalid checkout status request",
      detail: "The checkout status request is invalid.",
    })
    return
  }

  const secret = process.env.CHECKOUT_BFF_SECRET?.trim()
  if (!secret || secret.length < 32) {
    problem(req, res, {
      status: 503,
      code: "checkout_status_unavailable",
      title: "Checkout status is unavailable",
      detail: "Checkout recovery is not configured.",
    })
    return
  }

  const timestampValue = header(req, TIMESTAMP_HEADER)
  const proof = header(req, PROOF_HEADER)
  const timestamp = timestampValue ? Number(timestampValue) : Number.NaN
  if (
    !proof ||
    !verifyCheckoutStatusProof({
      cartId: parsed.data.cart_id,
      timestamp,
      secret,
      previousSecret: process.env.CHECKOUT_BFF_SECRET_PREVIOUS,
      proof,
    })
  ) {
    problem(req, res, {
      status: 401,
      code: "checkout_status_unauthorized",
      title: "Checkout status request is unauthorized",
      detail: "The checkout status proof is missing or invalid.",
    })
    return
  }

  try {
    const query = req.scope.resolve<CheckoutStatusQueryGraph>(
      ContainerRegistrationKeys.QUERY
    )
    const status = await resolveInternalCheckoutStatus(
      query,
      parsed.data.cart_id
    )
    res.setHeader("Cache-Control", "no-store")
    res.status(200).json(status)
  } catch {
    problem(req, res, {
      status: 503,
      code: "checkout_status_unavailable",
      title: "Checkout status is unavailable",
      detail: "Checkout status could not be resolved. Try again shortly.",
    })
  }
}
