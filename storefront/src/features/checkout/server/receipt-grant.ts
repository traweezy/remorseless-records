import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { checkoutServerEnv } from "@/config/env.checkout.server"

export const CHECKOUT_RECEIPT_COOKIE_NAME = "rr_checkout_receipt_v1"
export const CHECKOUT_RECEIPT_TTL_SECONDS = 30 * 60

const TOKEN_VERSION = "v1"
const ORDER_ID_PATTERN = /^order_[A-Za-z0-9]+$/
const MINIMUM_SECRET_LENGTH = 32

type ReceiptGrant = {
  orderId: string
  issuedAt: number
  expiresAt: number
}

type ReceiptPayload = {
  v: 1
  orderId: string
  iat: number
  exp: number
}

const validateSecret = (secret: string): string => {
  const normalized = secret.trim()
  if (normalized.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CHECKOUT_RECEIPT_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters`
    )
  }
  return normalized
}

const signatureFor = (payload: string, secret: string): string =>
  createHmac("sha256", validateSecret(secret))
    .update(`${TOKEN_VERSION}.${payload}`)
    .digest("base64url")

export const createReceiptGrant = (
  orderId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): string => {
  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new Error("Cannot issue a receipt grant for an invalid order")
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error("Cannot issue a receipt grant with an invalid time")
  }

  const payload: ReceiptPayload = {
    v: 1,
    orderId,
    iat: nowSeconds,
    exp: nowSeconds + CHECKOUT_RECEIPT_TTL_SECONDS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${TOKEN_VERSION}.${encoded}.${signatureFor(encoded, secret)}`
}

export const verifyReceiptGrant = (
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): ReceiptGrant | null => {
  if (!token || token.length > 1_024) {
    return null
  }

  let normalizedSecret: string
  try {
    normalizedSecret = validateSecret(secret)
  } catch {
    return null
  }

  const [version, encoded, suppliedSignature, ...extra] = token.split(".")
  if (
    version !== TOKEN_VERSION ||
    !encoded ||
    !suppliedSignature ||
    extra.length
  ) {
    return null
  }

  const expected = Buffer.from(signatureFor(encoded, normalizedSecret))
  const supplied = Buffer.from(suppliedSignature)
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return null
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<ReceiptPayload>
    if (
      payload.v !== 1 ||
      typeof payload.orderId !== "string" ||
      !ORDER_ID_PATTERN.test(payload.orderId) ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      (payload.iat as number) <= 0 ||
      (payload.exp as number) <= (payload.iat as number) ||
      (payload.exp as number) > (payload.iat as number) +
        CHECKOUT_RECEIPT_TTL_SECONDS ||
      nowSeconds < (payload.iat as number) - 30 ||
      nowSeconds >= (payload.exp as number)
    ) {
      return null
    }
    return {
      orderId: payload.orderId,
      issuedAt: payload.iat as number,
      expiresAt: payload.exp as number,
    }
  } catch {
    return null
  }
}

const resolveSecret = (): string => {
  if (!checkoutServerEnv.checkoutReceiptSecret) {
    throw new Error("Checkout receipt grants are not configured")
  }
  return checkoutServerEnv.checkoutReceiptSecret
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  priority: "high" as const,
}

const mutableResponse = (response: Response): NextResponse =>
  response instanceof NextResponse
    ? response
    : new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })

export const readReceiptGrant = (request: NextRequest): ReceiptGrant | null =>
  verifyReceiptGrant(
    request.cookies.get(CHECKOUT_RECEIPT_COOKIE_NAME)?.value,
    resolveSecret()
  )

export const setReceiptGrant = (
  response: Response,
  orderId: string
): Response => {
  const nextResponse = mutableResponse(response)
  nextResponse.cookies.set(
    CHECKOUT_RECEIPT_COOKIE_NAME,
    createReceiptGrant(orderId, resolveSecret()),
    {
      ...cookieOptions,
      maxAge: CHECKOUT_RECEIPT_TTL_SECONDS,
    }
  )
  return nextResponse
}

export const clearReceiptGrant = (response: Response): Response => {
  const nextResponse = mutableResponse(response)
  nextResponse.cookies.set(CHECKOUT_RECEIPT_COOKIE_NAME, "", {
    ...cookieOptions,
    maxAge: 0,
  })
  return nextResponse
}
