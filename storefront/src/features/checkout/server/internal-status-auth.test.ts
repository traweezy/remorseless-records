import { describe, expect, it } from "vitest"

import { createCheckoutStatusProof } from "@/features/checkout/server/internal-status-auth"

const secret = "0123456789abcdef0123456789abcdef"

describe("checkout status BFF proof", () => {
  it("matches the Backend proof fixture exactly", () => {
    expect(
      createCheckoutStatusProof({
        cartId: "cart_01K123ABC",
        timestamp: 1_800_000_000,
        secret,
      })
    ).toBe("7ixdb7qd4OXJ_262Lx1-u0MUrAJtuTl8_S9pzWlEtqU")
  })

  it.each([
    ["invalid cart", "../cart_01K123ABC", 1_800_000_000, secret],
    ["invalid timestamp", "cart_01K123ABC", 0, secret],
    ["short secret", "cart_01K123ABC", 1_800_000_000, "too-short"],
  ])("refuses to sign an %s", (_label, cartId, timestamp, key) => {
    expect(() =>
      createCheckoutStatusProof({
        cartId,
        timestamp,
        secret: key,
      })
    ).toThrow()
  })
})
