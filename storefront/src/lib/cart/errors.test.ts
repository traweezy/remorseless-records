import { describe, expect, it } from "vitest"

import { mapCartError } from "@/lib/cart/errors"

describe("cart error mapping", () => {
  it("maps inventory validation without exposing internal errors", () => {
    const problem = mapCartError(
      Object.assign(new Error("Requested quantity is not available"), {
        status: 400,
      }),
      "Unable to update cart."
    )

    expect(problem).toEqual({
      status: 422,
      code: "inventory_unavailable",
      title: "Inventory unavailable",
      detail: "Requested quantity is not available",
    })
  })

  it("returns a stable generic problem for unknown failures", () => {
    expect(
      mapCartError(new Error("database host leaked"), "Try again.")
    ).toEqual({
      status: 500,
      code: "cart_unavailable",
      title: "Cart temporarily unavailable",
      detail: "Try again.",
    })
  })

  it("maps upstream cancellation to a retryable timeout problem", () => {
    expect(
      mapCartError(new DOMException("timed out", "TimeoutError"), "Try again.")
    ).toEqual({
      status: 504,
      code: "cart_upstream_timeout",
      title: "Cart request timed out",
      detail: "The cart service took too long to respond. Please try again.",
    })
  })
})
