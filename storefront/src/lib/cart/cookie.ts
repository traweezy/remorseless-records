import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export const CART_COOKIE_NAME = "rr_cart_v1"
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

const CART_COOKIE_VERSION = "v1"
const CART_ID_PATTERN = /^cart_[A-Za-z0-9]+$/
const MINIMUM_SECRET_LENGTH = 32

type CartCookieResult =
  | { status: "missing" | "invalid"; cartId: null }
  | { status: "valid"; cartId: string; needsRotation: boolean }

const resolveSecret = (): string => {
  const configured = process.env.CART_COOKIE_SECRET?.trim()
  if (configured && configured.length >= MINIMUM_SECRET_LENGTH) {
    return configured
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev-only-cart-cookie-secret-change-me"
  }

  throw new Error(
    `CART_COOKIE_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters`
  )
}

const resolvePreviousSecret = (): string | null => {
  const configured = process.env.CART_COOKIE_SECRET_PREVIOUS?.trim()
  if (!configured) {
    return null
  }
  if (configured.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CART_COOKIE_SECRET_PREVIOUS must contain at least ${MINIMUM_SECRET_LENGTH} characters`
    )
  }
  return configured
}

const signatureFor = (cartId: string, secret: string): string =>
  createHmac("sha256", secret)
    .update(`${CART_COOKIE_VERSION}.${cartId}`)
    .digest("base64url")

export const signCartId = (cartId: string, secret: string): string => {
  if (!CART_ID_PATTERN.test(cartId)) {
    throw new Error("Cannot sign an invalid cart identifier")
  }
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error("Cart cookie secret is too short")
  }

  return `${CART_COOKIE_VERSION}.${cartId}.${signatureFor(cartId, secret)}`
}

export const verifyCartCookie = (
  value: string | null | undefined,
  secret: string
): string | null => {
  if (!value || secret.length < MINIMUM_SECRET_LENGTH) {
    return null
  }

  const [version, cartId, suppliedSignature, ...extra] = value.split(".")
  if (
    version !== CART_COOKIE_VERSION ||
    !cartId ||
    !CART_ID_PATTERN.test(cartId) ||
    !suppliedSignature ||
    extra.length
  ) {
    return null
  }

  const expected = Buffer.from(signatureFor(cartId, secret))
  const supplied = Buffer.from(suppliedSignature)
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    return null
  }

  return cartId
}

export const readCartCookie = (request: NextRequest): CartCookieResult => {
  const raw = request.cookies.get(CART_COOKIE_NAME)?.value
  if (!raw) {
    return { status: "missing", cartId: null }
  }

  const cartId = verifyCartCookie(raw, resolveSecret())
  if (cartId) {
    return { status: "valid", cartId, needsRotation: false }
  }

  const previousSecret = resolvePreviousSecret()
  const previousCartId = previousSecret
    ? verifyCartCookie(raw, previousSecret)
    : null
  return previousCartId
    ? { status: "valid", cartId: previousCartId, needsRotation: true }
    : { status: "invalid", cartId: null }
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

export const setCartCookie = (response: Response, cartId: string): Response => {
  const nextResponse = mutableResponse(response)
  nextResponse.cookies.set(
    CART_COOKIE_NAME,
    signCartId(cartId, resolveSecret()),
    {
      ...cookieOptions,
      maxAge: CART_COOKIE_MAX_AGE_SECONDS,
    }
  )
  return nextResponse
}

export const clearCartCookie = (response: Response): Response => {
  const nextResponse = mutableResponse(response)
  nextResponse.cookies.set(CART_COOKIE_NAME, "", {
    ...cookieOptions,
    maxAge: 0,
  })
  return nextResponse
}
