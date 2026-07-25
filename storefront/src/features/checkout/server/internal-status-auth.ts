import "server-only"

import { createHmac } from "node:crypto"

const PROOF_VERSION = "v1"
const PROOF_CONTEXT = "checkout-status"
const CART_ID_PATTERN = /^cart_[A-Za-z0-9]+$/
const MINIMUM_SECRET_LENGTH = 32

export const createCheckoutStatusProof = ({
  cartId,
  timestamp,
  secret,
}: {
  cartId: string
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
    .update(
      [PROOF_VERSION, PROOF_CONTEXT, String(timestamp), cartId].join("\n")
    )
    .digest("base64url")
}
