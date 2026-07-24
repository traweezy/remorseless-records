import type { HttpTypes } from "@medusajs/types"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cartMocks = vi.hoisted(() => ({
  removeItem: vi.fn(),
  updateItem: vi.fn(),
}))

vi.mock("@/providers/cart-provider", () => ({
  useCart: () => cartMocks,
}))
vi.mock("@/components/cart/cart-bundle-details", () => ({
  default: () => null,
}))
vi.mock("@/components/ui/smart-link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

import CartItem from "@/components/cart/cart-item"

const lineItemFixture = (
  overrides: Partial<HttpTypes.StoreCartLineItem> = {}
): HttpTypes.StoreCartLineItem =>
  ({
    id: "cali_01ABC",
    quantity: 1,
    title: "Test pressing",
    product_title: "Test pressing",
    product_handle: "music-release-test-artist-test-pressing",
    variant_id: "variant_01ABC",
    variant_title: "LP",
    unit_price: 2_400,
    subtotal: 2_400,
    variant: {
      id: "variant_01ABC",
      title: "LP",
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 3,
    },
    product: {
      id: "prod_01ABC",
      metadata: {
        artist_names: ["Test Artist"],
      },
    },
    ...overrides,
  }) as HttpTypes.StoreCartLineItem

describe("CartItem", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cartMocks.removeItem.mockResolvedValue(undefined)
    cartMocks.updateItem.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it("uses the quantity-zero contract when decrementing the last item", async () => {
    render(<CartItem item={lineItemFixture()} currencyCode="usd" />)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease quantity of Test pressing (removes item)",
      })
    )

    await waitFor(() => {
      expect(cartMocks.updateItem).toHaveBeenCalledWith("cali_01ABC", 0)
    })
  })

  it("shows exact low stock and prevents quantities beyond inventory", () => {
    render(
      <CartItem
        item={lineItemFixture({
          quantity: 3,
          subtotal: 7_200,
        })}
        currencyCode="usd"
      />
    )

    expect(screen.getByText("Only 3 available")).toBeInTheDocument()
    expect(screen.getByText("Test Artist")).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Increase quantity of Test pressing",
      })
    ).toBeDisabled()
  })

  it("uses the explicit remove action when supplied by the drawer", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    const item = lineItemFixture({ quantity: 2, subtotal: 4_800 })
    render(<CartItem item={item} currencyCode="usd" onRemove={onRemove} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Test pressing" })
    )

    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith(item)
    })
    expect(cartMocks.removeItem).not.toHaveBeenCalled()
  })
})
