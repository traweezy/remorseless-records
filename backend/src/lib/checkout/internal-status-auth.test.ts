import {
  CHECKOUT_STATUS_PROOF_MAX_SKEW_SECONDS,
  createCheckoutStatusProof,
  verifyCheckoutStatusProof,
} from "./internal-status-auth"

const secret = "0123456789abcdef0123456789abcdef"
const timestamp = 1_800_000_000
const cartId = "cart_01K123ABC"

describe("internal checkout status proof", () => {
  it("creates and verifies a deterministic proof", () => {
    const proof = createCheckoutStatusProof({ cartId, timestamp, secret })

    expect(proof).toBe(
      "7ixdb7qd4OXJ_262Lx1-u0MUrAJtuTl8_S9pzWlEtqU",
    )
    expect(
      verifyCheckoutStatusProof({
        cartId,
        timestamp,
        secret,
        proof,
        nowSeconds: timestamp,
      }),
    ).toBe(true)
  })

  it.each([
    ["another cart", "cart_01K999XYZ", timestamp, secret],
    ["another time", cartId, timestamp + 1, secret],
    [
      "another secret",
      cartId,
      timestamp,
      "fedcba9876543210fedcba9876543210",
    ],
  ])("rejects a proof reused with %s", (_label, nextCartId, nextTime, key) => {
    const proof = createCheckoutStatusProof({ cartId, timestamp, secret })

    expect(
      verifyCheckoutStatusProof({
        cartId: nextCartId,
        timestamp: nextTime,
        secret: key,
        proof,
        nowSeconds: timestamp,
      }),
    ).toBe(false)
  })

  it.each([
    timestamp - CHECKOUT_STATUS_PROOF_MAX_SKEW_SECONDS - 1,
    timestamp + CHECKOUT_STATUS_PROOF_MAX_SKEW_SECONDS + 1,
  ])("rejects a timestamp outside the replay window: %d", (nowSeconds) => {
    const proof = createCheckoutStatusProof({ cartId, timestamp, secret })

    expect(
      verifyCheckoutStatusProof({
        cartId,
        timestamp,
        secret,
        proof,
        nowSeconds,
      }),
    ).toBe(false)
  })

  it.each([
    ["invalid cart", "../cart_01K123ABC", timestamp, secret],
    ["invalid timestamp", cartId, 0, secret],
    ["short secret", cartId, timestamp, "too-short"],
  ])("refuses to sign an %s", (_label, nextCartId, nextTime, key) => {
    expect(() =>
      createCheckoutStatusProof({
        cartId: nextCartId,
        timestamp: nextTime,
        secret: key,
      }),
    ).toThrow()
  })
})
