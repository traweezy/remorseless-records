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

vi.mock("@/components/ui/smart-link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock("@/providers/cart-provider", () => ({
  useCart: () => ({
    addItem: addItemMock,
    itemCount: 0,
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
        calculated_amount: 33,
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
        calculated_amount: 56,
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
    const cdFormat = within(quickShop).getByRole("button", {
      name: /3CD Bundle/i,
    })
    const lpFormat = within(quickShop).getByRole("button", {
      name: /3LP Bundle/i,
    })

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
    expect(
      within(quickShop).queryByText("Selected Format", { exact: true })
    ).not.toBeInTheDocument()
    expect(
      within(quickShop).queryByText("Format", { exact: true })
    ).not.toBeInTheDocument()
    expect(cdFormat).toHaveAttribute("aria-pressed", "true")
    expect(lpFormat).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(lpFormat)

    expect(cdFormat).toHaveAttribute("aria-pressed", "false")
    expect(lpFormat).toHaveAttribute("aria-pressed", "true")
  })

  it("offers checkout after an item is added without opening the cart", async () => {
    addItemMock.mockResolvedValue(undefined)
    render(
      <ProductQuickView handle={product.handle} open onOpenChange={vi.fn()} />
    )

    const quickShop = screen.getByRole("dialog", { name: "Quick shop" })
    expect(
      within(quickShop).queryByRole("link", { name: "Checkout" })
    ).not.toBeInTheDocument()

    fireEvent.click(
      within(quickShop).getByRole("button", { name: "Add to cart" })
    )

    expect(
      await within(quickShop).findByRole("link", { name: "Checkout" })
    ).toHaveAttribute("href", "/checkout")
  })
})
