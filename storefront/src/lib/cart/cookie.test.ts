import { NextRequest, NextResponse } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearCartCookie,
  readCartCookie,
  setCartCookie,
  signCartId,
  verifyCartCookie,
} from "@/lib/cart/cookie"

const secret = "0123456789abcdef0123456789abcdef"

describe("cart cookie signatures", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("round-trips a valid Medusa cart identifier", () => {
    const signed = signCartId("cart_01K123ABC", secret)

    expect(verifyCartCookie(signed, secret)).toBe("cart_01K123ABC")
  })

  it("rejects tampered identifiers and signatures", () => {
    const signed = signCartId("cart_01K123ABC", secret)

    expect(
      verifyCartCookie(signed.replace("01K123ABC", "01K999XYZ"), secret)
    ).toBeNull()
    expect(verifyCartCookie(`${signed}x`, secret)).toBeNull()
  })

  it("rejects malformed values and short secrets", () => {
    expect(verifyCartCookie("not-a-cart-cookie", secret)).toBeNull()
    expect(verifyCartCookie(null, secret)).toBeNull()
    expect(() => signCartId("cart_01K123ABC", "too-short")).toThrow(
      "secret is too short"
    )
    expect(() => signCartId("../cart_01K123ABC", secret)).toThrow(
      "invalid cart identifier"
    )
  })

  it("writes replayable secure cookie attributes onto the response", () => {
    const response = setCartCookie(
      NextResponse.json({ cart: null }),
      "cart_01K123ABC"
    )
    const setCookie = response.headers.get("Set-Cookie")

    expect(setCookie).toContain("rr_cart_v1=v1.cart_01K123ABC.")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=lax")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("Priority=high")
  })

  it("expires the cart cookie on the returned response", () => {
    const response = clearCartCookie(NextResponse.json({ cart: null }))

    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0")
  })

  it("accepts the previous key and marks the cookie for rotation", () => {
    const previousSecret = "abcdef0123456789abcdef0123456789"
    vi.stubEnv("CART_COOKIE_SECRET", "fedcba9876543210fedcba9876543210")
    vi.stubEnv("CART_COOKIE_SECRET_PREVIOUS", previousSecret)
    const signed = signCartId("cart_01K123ABC", previousSecret)
    const request = new NextRequest("https://storefront.test/api/cart", {
      headers: {
        cookie: `rr_cart_v1=${signed}`,
      },
    })

    expect(readCartCookie(request)).toEqual({
      status: "valid",
      cartId: "cart_01K123ABC",
      needsRotation: true,
    })
  })
})
