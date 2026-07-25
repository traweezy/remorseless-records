import { describe, expect, it } from "vitest"

import { preservePreparedPayment } from "@/features/checkout/hooks/use-checkout"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"

const checkout = (
  revision: string,
  clientSecret: string | null
): CheckoutProjection =>
  ({
    revision,
    payment: {
      provider: "stripe",
      clientSecret,
      status: "pending",
      canRestart: false,
    },
  }) as CheckoutProjection

describe("preservePreparedPayment", () => {
  it("keeps the mounted client secret across same-revision refetches", () => {
    const current = checkout("revision-a", "pi_test_secret")
    const refreshed = checkout("revision-a", null)

    expect(
      preservePreparedPayment(current, refreshed).payment.clientSecret
    ).toBe("pi_test_secret")
  })

  it("discards a client secret when the authoritative checkout changes", () => {
    const current = checkout("revision-a", "pi_test_secret")
    const changed = checkout("revision-b", null)

    expect(preservePreparedPayment(current, changed).payment.clientSecret).toBe(
      null
    )
  })
})
