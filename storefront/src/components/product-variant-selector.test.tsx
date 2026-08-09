import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ProductVariantSelector from "@/components/product-variant-selector"
import type { VariantOption } from "@/types/product"

const useCartMock = vi.hoisted(() => vi.fn())
const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/providers/cart-provider", () => ({
  useCart: useCartMock,
}))
vi.mock("sonner", () => ({
  toast: toastMocks,
}))

const variant: VariantOption = {
  id: "variant_cd",
  title: "CD",
  currency: "usd",
  amount: 24,
  hasPrice: true,
  inStock: true,
  stockStatus: "in_stock",
  inventoryQuantity: 8,
}

describe("ProductVariantSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("confirms a successful add in place without a success toast", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined)
    useCartMock.mockReturnValue({ addItem })
    render(
      <ProductVariantSelector
        variants={[variant]}
        productTitle="Test pressing"
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to cart" }))
      await Promise.resolve()
    })

    expect(addItem).toHaveBeenCalledWith("variant_cd", 1)
    expect(screen.getByRole("button", { name: "Added" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      "Test pressing added to cart."
    )
    expect(toastMocks.success).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(
      screen.getByRole("button", { name: "Add to cart" })
    ).toBeInTheDocument()
  })

  it("restores the add action and reports a failed mutation", async () => {
    const addItem = vi.fn().mockRejectedValue(new Error("upstream unavailable"))
    useCartMock.mockReturnValue({ addItem })
    render(
      <ProductVariantSelector
        variants={[variant]}
        productTitle="Test pressing"
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to cart" }))
      await Promise.resolve()
    })

    expect(
      screen.getByRole("button", { name: "Add to cart" })
    ).toBeInTheDocument()
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Unable to add this item right now."
    )
  })

  it("clamps requested quantities to verified inventory", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined)
    useCartMock.mockReturnValue({ addItem })
    render(
      <ProductVariantSelector
        variants={[{ ...variant, inventoryQuantity: 2 }]}
        productTitle="Test pressing"
      />
    )

    fireEvent.change(screen.getByLabelText("Qty"), {
      target: { value: "50" },
    })
    expect(screen.getByLabelText("Qty")).toHaveValue(2)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add to cart" }))
      await Promise.resolve()
    })

    expect(addItem).toHaveBeenCalledWith("variant_cd", 2)
  })

  it("prevents sold-out variants from issuing a cart request", () => {
    const addItem = vi.fn()
    useCartMock.mockReturnValue({ addItem })
    render(
      <ProductVariantSelector
        variants={[
          {
            ...variant,
            inStock: false,
            stockStatus: "sold_out",
            inventoryQuantity: 0,
          },
        ]}
        productTitle="Test pressing"
      />
    )

    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled()
    expect(screen.queryByText("$24.00")).not.toBeInTheDocument()
    expect(addItem).not.toHaveBeenCalled()
  })
})
