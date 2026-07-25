import { describe, expect, it } from "vitest"

import {
  safeStripeErrorMessage,
  stripeResultNeedsReconciliation,
} from "@/features/checkout/lib/checkout-copy"

describe("checkout payment copy", () => {
  it.each([
    ["insufficient_funds", "insufficient funds"],
    ["expired_card", "expired"],
    ["incorrect_cvc", "security code is incorrect"],
  ])("maps %s without exposing provider text", (declineCode, expected) => {
    expect(
      safeStripeErrorMessage({
        code: "card_declined",
        decline_code: declineCode,
        type: "card_error",
      })
    ).toContain(expected)
  })

  it("uses a safe generic decline message for unknown decline codes", () => {
    const message = safeStripeErrorMessage({
      code: "card_declined",
      decline_code: "do_not_honor",
      type: "card_error",
    })

    expect(message).toBe(
      "The payment was declined. Try another payment method."
    )
    expect(message).not.toContain("do_not_honor")
  })

  it.each(["api_connection_error", "api_error"] as const)(
    "treats %s as an ambiguous result",
    (type) => {
      expect(stripeResultNeedsReconciliation({ type })).toBe(true)
      expect(
        safeStripeErrorMessage({
          type,
        })
      ).toContain("Do not pay again")
    }
  )
})
