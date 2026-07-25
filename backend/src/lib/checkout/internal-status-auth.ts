import { createHmac, timingSafeEqual } from "node:crypto"

const PROOF_VERSION = "v1"
const PROOF_CONTEXT = "checkout-status"
const CART_ID_PATTERN = /^cart_[A-Za-z0-9]+$/
const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MINIMUM_SECRET_LENGTH = 32

export const CHECKOUT_STATUS_PROOF_MAX_SKEW_SECONDS = 30

type CheckoutStatusProofInput = {
  cartId: string
  timestamp: number
  secret: string
}

type VerifyCheckoutStatusProofInput = CheckoutStatusProofInput & {
  proof: string
  nowSeconds?: number
}

const validateSigningInput = ({
  cartId,
  timestamp,
  secret,
}: CheckoutStatusProofInput): void => {
  if (!CART_ID_PATTERN.test(cartId)) {
    throw new Error("Checkout status proof received an invalid cart identifier")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Checkout status proof received an invalid timestamp")
  }
  if (secret.trim().length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CHECKOUT_BFF_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters`,
    )
  }
}

const signedPayload = (cartId: string, timestamp: number): string =>
  [PROOF_VERSION, PROOF_CONTEXT, String(timestamp), cartId].join("\n")

export const createCheckoutStatusProof = ({
  cartId,
  timestamp,
  secret,
}: CheckoutStatusProofInput): string => {
  validateSigningInput({ cartId, timestamp, secret })
  return createHmac("sha256", secret.trim())
    .update(signedPayload(cartId, timestamp))
    .digest("base64url")
}

export const verifyCheckoutStatusProof = ({
  cartId,
  timestamp,
  secret,
  proof,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyCheckoutStatusProofInput): boolean => {
  try {
    validateSigningInput({ cartId, timestamp, secret })
  } catch {
    return false
  }

  if (
    !Number.isSafeInteger(nowSeconds) ||
    Math.abs(nowSeconds - timestamp) > CHECKOUT_STATUS_PROOF_MAX_SKEW_SECONDS ||
    !PROOF_PATTERN.test(proof)
  ) {
    return false
  }

  const expected = Buffer.from(
    createCheckoutStatusProof({ cartId, timestamp, secret }),
  )
  const supplied = Buffer.from(proof)
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  )
}
