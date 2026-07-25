import type { HttpTypes } from "@medusajs/types"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
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
  default: ({
    item,
    onRemove,
  }: {
    item: HttpTypes.StoreCartLineItem
    onRemove: (item: HttpTypes.StoreCartLineItem) => Promise<void>
  }) => (
    <article>
      {item.title}
      <button
        type="button"
        onClick={() => {
          void onRemove(item)
        }}
      >
        Remove {item.title}
      </button>
    </article>
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
        variant_id: "variant_01ABC",
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

  it("keeps the empty state concise", () => {
    useCartMock.mockReturnValue(
      cartState({
        cart: null,
        itemCount: 0,
      })
    )
    render(<CartDrawer open onOpenChange={vi.fn()} />)

    expect(screen.getByText("Your cart is empty")).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Browse the catalog and choose a format to get started."
      )
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Browse catalog" })
    ).toBeInTheDocument()
  })

  it("restores a recently removed item from inside the drawer", async () => {
    const addItem = vi.fn().mockResolvedValue(undefined)
    const removeItem = vi.fn().mockResolvedValue(undefined)
    useCartMock.mockReturnValue(cartState({ addItem, removeItem }))
    render(<CartDrawer open onOpenChange={vi.fn()} />)

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Test pressing" })
    )

    const undo = await screen.findByRole("button", { name: "Undo" })
    expect(screen.getByText("Test pressing removed")).toBeInTheDocument()
    expect(removeItem).toHaveBeenCalledWith("cali_01ABC")

    fireEvent.click(undo)

    await waitFor(() => {
      expect(addItem).toHaveBeenCalledWith("variant_01ABC", 1)
    })
    expect(
      screen.queryByRole("button", { name: "Undo" })
    ).not.toBeInTheDocument()
  })
})
