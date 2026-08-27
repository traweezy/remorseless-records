import "server-only"

import { createHash, createHmac } from "node:crypto"

const PROOF_VERSION = "v1"
const MINIMUM_SECRET_LENGTH = 32

export type PublicFormPurpose = "contact" | "privacy-request"

type PublicFormProofInput = {
  body: string
  purpose: PublicFormPurpose
  secret: string
  timestamp: number
}

const validateProofInput = ({
  body,
  secret,
  timestamp,
}: PublicFormProofInput): void => {
  if (!body.length) {
    throw new Error("Cannot sign an empty public-form body")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Cannot sign an invalid public-form timestamp")
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
