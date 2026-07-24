import type { HttpTypes } from "@medusajs/types"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ProductQuickView from "@/components/product-quick-view"

const { addItemMock, productDetailQueryMock } = vi.hoisted(() => ({
  addItemMock: vi.fn(),
  productDetailQueryMock: vi.fn(),
}))

vi.mock("@/lib/query/products", () => ({
  useProductDetailQuery: productDetailQueryMock,
}))

vi.mock("@/providers/cart-provider", () => ({
  useCart: () => ({
    addItem: addItemMock,
  }),
}))

const product = {
  id: "prod_bundle",
  handle: "discography-bundle",
  title: "Concrete Winds - Discography Bundle",
  description: "Three albums, available on CD or vinyl.",
  variants: [
    {
      id: "variant_cd",
      title: "3CD Bundle",
      calculated_price: {
        calculated_amount: 3_300,
        currency_code: "usd",
      },
      inventory_quantity: 2,
      manage_inventory: true,
      allow_backorder: false,
      metadata: {
        inventory_count_status: "verified",
      },
    },
    {
      id: "variant_lp",
      title: "3LP Bundle",
      calculated_price: {
        calculated_amount: 5_600,
        currency_code: "usd",
      },
      inventory_quantity: 1,
      manage_inventory: true,
      allow_backorder: false,
      metadata: {
        inventory_count_status: "verified",
      },
    },
  ],
} as unknown as HttpTypes.StoreProduct

describe("ProductQuickView", () => {
  beforeEach(() => {
    productDetailQueryMock.mockReturnValue({
      data: product,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("matches detail-page pricing and exact low-stock presentation", () => {
    render(
      <ProductQuickView handle={product.handle} open onOpenChange={vi.fn()} />
    )

    const quickShop = screen.getByRole("dialog", { name: "Quick shop" })
    const selectedFormat = within(quickShop).getByText("Selected Format", {
      exact: true,
    }).parentElement

    expect(
      within(quickShop).getAllByText("$33.00", { exact: true })
    ).toHaveLength(1)
    expect(
      within(quickShop).getAllByText("$56.00", { exact: true })
    ).toHaveLength(1)
    expect(
      within(quickShop).getByText("Only 2 left", { exact: true })
    ).toBeInTheDocument()
    expect(
      within(quickShop).getByText("Only 1 left", { exact: true })
    ).toBeInTheDocument()
    expect(selectedFormat).toHaveTextContent("3CD Bundle")
    expect(selectedFormat).not.toHaveTextContent("$33.00")

    fireEvent.click(
      within(quickShop).getByRole("button", { name: /3LP Bundle/i })
    )

    expect(selectedFormat).toHaveTextContent("3LP Bundle")
    expect(selectedFormat).not.toHaveTextContent("$56.00")
  })
})
