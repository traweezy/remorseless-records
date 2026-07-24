import type { HttpTypes } from "@medusajs/types"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))
const useCartMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}))
vi.mock("@/providers/cart-provider", () => ({
  useCart: useCartMock,
}))
vi.mock("@/components/cart/cart-item", () => ({
  default: ({ item }: { item: HttpTypes.StoreCartLineItem }) => (
    <article>{item.title}</article>
  ),
}))
vi.mock("@/components/ui/drawer", () => ({
  default: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => (open ? <aside role="dialog">{children}</aside> : null),
  DrawerCloseButton: ({ label }: { label: string }) => (
    <button type="button" aria-label={label} />
  ),
  DrawerHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DrawerHeading: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DrawerTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))
vi.mock("sonner", () => ({ toast: vi.fn() }))

import CartDrawer from "@/components/cart-drawer"

const cartFixture = (): HttpTypes.StoreCart =>
  ({
    id: "cart_active",
    currency_code: "usd",
    subtotal: 2_400,
    total: 2_400,
    items: [
      {
        id: "cali_01ABC",
        title: "Test pressing",
        quantity: 1,
        unit_price: 2_400,
        subtotal: 2_400,
      },
    ],
  }) as HttpTypes.StoreCart

const cartState = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  addItem: vi.fn(),
  cart: cartFixture(),
  error: null,
  isLoading: false,
  isMutating: false,
  itemCount: 1,
  refreshCart: vi.fn(),
  removeItem: vi.fn(),
  ...overrides,
})

describe("CartDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCartMock.mockReturnValue(cartState())
  })

  afterEach(cleanup)

  it("labels unknown shipping and tax honestly before checkout", () => {
    render(<CartDrawer open onOpenChange={vi.fn()} />)

    expect(screen.getAllByText("Calculated at checkout")).toHaveLength(2)
    expect(screen.getByText("Current total")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Shipping and tax are confirmed after you enter your address."
      )
    ).toBeInTheDocument()
  })

  it("keeps checkout disabled while a cart mutation is pending", () => {
    useCartMock.mockReturnValue(cartState({ isMutating: true }))
    render(<CartDrawer open onOpenChange={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled()
  })

  it("closes the drawer and navigates to checkout when ready", () => {
    const onOpenChange = vi.fn()
    render(<CartDrawer open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Checkout" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(routerMocks.push).toHaveBeenCalledWith("/checkout")
  })

  it("shows the skeleton state without an empty-cart flash", () => {
    useCartMock.mockReturnValue(
      cartState({
        cart: null,
        isLoading: true,
        itemCount: 0,
      })
    )
    render(<CartDrawer open onOpenChange={vi.fn()} />)

    expect(screen.getByLabelText("Loading cart")).toBeInTheDocument()
    expect(screen.queryByText("Your cart is empty")).not.toBeInTheDocument()
  })
})
