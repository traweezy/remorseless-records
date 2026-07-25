import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cartApiMocks = vi.hoisted(() => ({
  addShippingMethod: vi.fn(),
  calculateTaxes: vi.fn(),
  listShippingOptions: vi.fn(),
}))

vi.mock("@/lib/cart/api", () => cartApiMocks)

import {
  CheckoutRevalidationError,
  revalidateShippingAndTaxes,
} from "@/features/checkout/server/revalidate"

const cart = {
  id: "cart_signed",
  shipping_methods: [{ shipping_option_id: "so_standard" }],
} as HttpTypes.StoreCart

describe("checkout shipping and tax revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("persists an eligible selection before recalculating tax", async () => {
    const recalculated = { ...cart, total: 24.99 }
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: [
        { id: "so_standard", insufficient_inventory: false },
      ],
    })
    cartApiMocks.addShippingMethod.mockResolvedValue(cart)
    cartApiMocks.calculateTaxes.mockResolvedValue(recalculated)

    await expect(revalidateShippingAndTaxes(cart)).resolves.toBe(recalculated)
    expect(cartApiMocks.addShippingMethod).toHaveBeenCalledWith(
      "cart_signed",
      "so_standard"
    )
    expect(cartApiMocks.calculateTaxes).toHaveBeenCalledWith("cart_signed")
    expect(
      cartApiMocks.addShippingMethod.mock.invocationCallOrder[0]
    ).toBeLessThan(cartApiMocks.calculateTaxes.mock.invocationCallOrder[0]!)
  })

  it.each([
    ["missing", { ...cart, shipping_methods: [] }, []],
    ["stale", cart, []],
    [
      "out of stock",
      cart,
      [{ id: "so_standard", insufficient_inventory: true }],
    ],
  ])("rejects a %s shipping selection", async (_label, input, options) => {
    cartApiMocks.listShippingOptions.mockResolvedValue({
      shipping_options: options,
    })

    await expect(revalidateShippingAndTaxes(input)).rejects.toBeInstanceOf(
      CheckoutRevalidationError
    )
    expect(cartApiMocks.addShippingMethod).not.toHaveBeenCalled()
    expect(cartApiMocks.calculateTaxes).not.toHaveBeenCalled()
  })
})
