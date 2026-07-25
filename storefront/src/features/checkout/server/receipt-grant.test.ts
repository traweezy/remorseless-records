import { describe, expect, it } from "vitest"

import {
  CHECKOUT_RECEIPT_COOKIE_NAME,
  CHECKOUT_RECEIPT_TTL_SECONDS,
  createReceiptGrant,
  verifyReceiptGrant,
} from "@/features/checkout/server/receipt-grant"

const secret = "0123456789abcdef0123456789abcdef"
const now = 1_800_000_000

describe("checkout receipt grant", () => {
  it("issues and verifies a short-lived order grant", () => {
    const token = createReceiptGrant("order_01K123ABC", secret, now)

    expect(verifyReceiptGrant(token, secret, now)).toEqual({
      orderId: "order_01K123ABC",
      issuedAt: now,
      expiresAt: now + CHECKOUT_RECEIPT_TTL_SECONDS,
    })
    expect(token).not.toContain("buyer@example.test")
  })

  it.each([
    ["tampered payload", (token: string) => token.replace("v1.", "v1.e")],
    [
      "tampered signature",
      (token: string) => `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    ],
  ])("rejects a %s", (_label, tamper) => {
    const token = createReceiptGrant("order_01K123ABC", secret, now)

    expect(verifyReceiptGrant(tamper(token), secret, now)).toBeNull()
  })

  it("rejects a grant signed with another secret", () => {
    const token = createReceiptGrant("order_01K123ABC", secret, now)

    expect(
      verifyReceiptGrant(
        token,
        "fedcba9876543210fedcba9876543210",
        now
      )
    ).toBeNull()
  })

  it("rejects an expired grant", () => {
    const token = createReceiptGrant("order_01K123ABC", secret, now)

    expect(
      verifyReceiptGrant(token, secret, now + CHECKOUT_RECEIPT_TTL_SECONDS)
    ).toBeNull()
  })

  it.each([
    ["invalid order", "../order_01K123ABC", secret],
    ["short secret", "order_01K123ABC", "too-short"],
  ])("refuses to issue for an %s", (_label, orderId, key) => {
    expect(() => createReceiptGrant(orderId, key, now)).toThrow()
  })

  it("uses a versioned, host-only cookie name", () => {
    expect(CHECKOUT_RECEIPT_COOKIE_NAME).toBe("rr_checkout_receipt_v1")
  })
})
