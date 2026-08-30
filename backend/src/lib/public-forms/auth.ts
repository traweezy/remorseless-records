import { createHash, createHmac, timingSafeEqual } from "node:crypto"

const PROOF_VERSION = "v1"
const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const MINIMUM_SECRET_LENGTH = 32

export const PUBLIC_FORM_PROOF_MAX_SKEW_SECONDS = 30

export type PublicFormPurpose = "contact" | "privacy-request"

type PublicFormProofInput = {
  body: string
  purpose: PublicFormPurpose
  secret: string
  timestamp: number
}

type VerifyPublicFormProofInput = PublicFormProofInput & {
  nowSeconds?: number
  previousSecret?: string | undefined
  proof: string
}

const validateProofInput = ({
  body,
  secret,
  timestamp,
}: PublicFormProofInput): void => {
  if (!body.length) {
    throw new Error("Public-form proof received an empty body")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Public-form proof received an invalid timestamp")
  }
  if (secret.trim().length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `PUBLIC_FORM_BFF_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters`
    )
  }
}

const bodyDigest = (body: string): string =>
  createHash("sha256").update(body).digest("base64url")

export const createPublicFormProof = (input: PublicFormProofInput): string => {
  validateProofInput(input)
  const payload = [
    PROOF_VERSION,
    input.purpose,
    String(input.timestamp),
    bodyDigest(input.body),
  ].join("\n")

  return createHmac("sha256", input.secret.trim())
    .update(payload)
    .digest("base64url")
}

export const verifyPublicFormProof = ({
  nowSeconds = Math.floor(Date.now() / 1000),
  previousSecret,
  proof,
  ...input
}: VerifyPublicFormProofInput): boolean => {
  try {
    validateProofInput(input)
  } catch {
    return false
  }

  if (
    !Number.isSafeInteger(nowSeconds) ||
    Math.abs(nowSeconds - input.timestamp) >
      PUBLIC_FORM_PROOF_MAX_SKEW_SECONDS ||
    !PROOF_PATTERN.test(proof)
  ) {
    return false
  }

  const supplied = Buffer.from(proof)
  const verifiesWith = (candidate: string): boolean => {
    try {
      validateProofInput({ ...input, secret: candidate })
    } catch {
      return false
    }
    const expected = Buffer.from(
      createPublicFormProof({ ...input, secret: candidate })
    )
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    )
  }

  return (
    verifiesWith(input.secret) ||
    (previousSecret ? verifiesWith(previousSecret) : false)
  )
}
