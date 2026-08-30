import "server-only"

import { createHmac } from "node:crypto"

const PROOF_VERSION = "v1"
const CART_ID_PATTERN = /^cart_[A-Za-z0-9]+$/
const MINIMUM_SECRET_LENGTH = 32

type CheckoutProofPurpose = "checkout-status" | "checkout-tax-link"

const createCheckoutProof = ({
  cartId,
  timestamp,
  secret,
  purpose,
}: {
  cartId: string
  purpose: CheckoutProofPurpose
  timestamp: number
  secret: string
}): string => {
  if (!CART_ID_PATTERN.test(cartId)) {
    throw new Error("Cannot sign an invalid checkout cart identifier")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Cannot sign an invalid checkout timestamp")
  }
  if (secret.trim().length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CHECKOUT_BFF_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters`
    )
  }

  return createHmac("sha256", secret.trim())
    .update([PROOF_VERSION, purpose, String(timestamp), cartId].join("\n"))
    .digest("base64url")
}

type CheckoutProofInput = {
  cartId: string
  timestamp: number
  secret: string
}

export const createCheckoutStatusProof = (input: CheckoutProofInput): string =>
  createCheckoutProof({ ...input, purpose: "checkout-status" })

export const createCheckoutTaxLinkProof = (input: CheckoutProofInput): string =>
  createCheckoutProof({ ...input, purpose: "checkout-tax-link" })
