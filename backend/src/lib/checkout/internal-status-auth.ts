import { createHmac, timingSafeEqual } from "node:crypto"

const PROOF_VERSION = "v1"
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
  previousSecret?: string | undefined
}

type CheckoutProofPurpose = "checkout-status" | "checkout-tax-link"

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

const signedPayload = (
  purpose: CheckoutProofPurpose,
  cartId: string,
  timestamp: number,
): string =>
  [PROOF_VERSION, purpose, String(timestamp), cartId].join("\n")

const createCheckoutProof = ({
  cartId,
  timestamp,
  secret,
  purpose,
}: CheckoutStatusProofInput & {
  purpose: CheckoutProofPurpose
}): string => {
  validateSigningInput({ cartId, timestamp, secret })
  return createHmac("sha256", secret.trim())
    .update(signedPayload(purpose, cartId, timestamp))
    .digest("base64url")
}

const verifyCheckoutProof = ({
  cartId,
  timestamp,
  secret,
  previousSecret,
  proof,
  purpose,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyCheckoutStatusProofInput & {
  purpose: CheckoutProofPurpose
}): boolean => {
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

  const supplied = Buffer.from(proof)
  const verifiesWith = (candidate: string): boolean => {
    try {
      validateSigningInput({ cartId, timestamp, secret: candidate })
    } catch {
      return false
    }
    const expected = Buffer.from(
      createCheckoutProof({ cartId, timestamp, secret: candidate, purpose }),
    )
    return (
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied)
    )
  }

  return (
    verifiesWith(secret) ||
    (previousSecret ? verifiesWith(previousSecret) : false)
  )
}

export const createCheckoutStatusProof = (
  input: CheckoutStatusProofInput,
): string => createCheckoutProof({ ...input, purpose: "checkout-status" })

export const createCheckoutTaxLinkProof = (
  input: CheckoutStatusProofInput,
): string => createCheckoutProof({ ...input, purpose: "checkout-tax-link" })

export const verifyCheckoutStatusProof = (
  input: VerifyCheckoutStatusProofInput,
): boolean => verifyCheckoutProof({ ...input, purpose: "checkout-status" })

export const verifyCheckoutTaxLinkProof = (
  input: VerifyCheckoutStatusProofInput,
): boolean => verifyCheckoutProof({ ...input, purpose: "checkout-tax-link" })
