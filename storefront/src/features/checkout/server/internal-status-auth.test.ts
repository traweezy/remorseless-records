import { describe, expect, it } from "vitest"

import {
  createCheckoutStatusProof,
  createCheckoutTaxLinkProof,
} from "@/features/checkout/server/internal-status-auth"

const secret = ["unit", "test", "checkout", "key"].join("-").repeat(2)

describe("checkout status BFF proof", () => {
  it("matches the Backend proof fixture exactly", () => {
    expect(
      createCheckoutStatusProof({
        cartId: "cart_01K123ABC",
        timestamp: 1_800_000_000,
        secret,
      })
    ).toBe("u0foJnfY32c06wyhJ8UGRbtC9zUP4MMD_F60K5k-WTs")
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

  it("uses a distinct signature context for tax linking", () => {
    const input = {
      cartId: "cart_01K123ABC",
      timestamp: 1_800_000_000,
      secret,
    }

    expect(createCheckoutTaxLinkProof(input)).not.toBe(
      createCheckoutStatusProof(input)
    )
  })
})
