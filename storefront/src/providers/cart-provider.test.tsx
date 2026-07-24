import type { HttpTypes } from "@medusajs/types"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cartClientMocks = vi.hoisted(() => ({
  addLineItem: vi.fn(),
  addShippingMethod: vi.fn(),
  calculateTaxes: vi.fn(),
  clearCartSession: vi.fn(),
  completeCart: vi.fn(),
  getCart: vi.fn(),
  initPaymentSessions: vi.fn(),
  listShippingOptions: vi.fn(),
  removeLineItem: vi.fn(),
  setAddresses: vi.fn(),
  setEmail: vi.fn(),
  updateLineItem: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock("@/lib/cart/client", () => cartClientMocks)
vi.mock("sonner", () => ({ toast: toastMocks }))

import { CartProvider, useCart } from "@/providers/cart-provider"

const cartFixture = (
  id: string,
  items: HttpTypes.StoreCartLineItem[] = []
): HttpTypes.StoreCart =>
  ({
    id,
    currency_code: "usd",
    items,
    subtotal: items.reduce(
      (total, item) => total + Number(item.subtotal ?? 0),
      0
    ),
    total: items.reduce(
      (total, item) => total + Number(item.total ?? item.subtotal ?? 0),
      0
    ),
  }) as HttpTypes.StoreCart

const lineItemFixture = (
  id: string,
  variantId: string,
  quantity = 1
): HttpTypes.StoreCartLineItem =>
  ({
    id,
    variant_id: variantId,
    title: `Product ${variantId}`,
    quantity,
    unit_price: 2_000,
    subtotal: 2_000 * quantity,
    total: 2_000 * quantity,
  }) as HttpTypes.StoreCartLineItem

const deferred = <T,>() => {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return { promise, resolve: resolvePromise }
}

const CartConsumer = () => {
  const { addItem, cart, isLoading, isMutating, itemCount, updateItem } =
    useCart()

  return (
    <div>
      <output data-testid="loading">{String(isLoading)}</output>
      <output data-testid="mutating">{String(isMutating)}</output>
      <output data-testid="cart-id">{cart?.id ?? "none"}</output>
      <output data-testid="item-count">{itemCount}</output>
      <button type="button" onClick={() => void addItem("variant-a")}>
        Add A
      </button>
      <button type="button" onClick={() => void addItem("variant-b")}>
        Add B
      </button>
      <button type="button" onClick={() => void updateItem("line-a", 2)}>
        Update A
      </button>
      <button type="button" onClick={() => void updateItem("line-b", 2)}>
        Update B
      </button>
      <button type="button" onClick={() => void updateItem("line-a", 0)}>
        Remove A with zero
      </button>
    </div>
  )
}

const renderProvider = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CartProvider>{children}</CartProvider>
    </QueryClientProvider>
  )

  return render(<CartConsumer />, { wrapper: Wrapper })
}

describe("CartProvider lifecycle", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    cartClientMocks.getCart.mockResolvedValue(null)
  })

  it("loads an empty session without creating a cart", async () => {
    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false")
    })

    expect(screen.getByTestId("cart-id")).toHaveTextContent("none")
    expect(cartClientMocks.getCart).toHaveBeenCalledOnce()
    expect(cartClientMocks.addLineItem).not.toHaveBeenCalled()
  })

  it("retrieves an existing guest cart through the cookie-backed endpoint", async () => {
    const existingCart = cartFixture("cart_existing", [
      lineItemFixture("line-a", "variant-a"),
    ])
    cartClientMocks.getCart.mockResolvedValue(existingCart)

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId("cart-id")).toHaveTextContent("cart_existing")
    })

    expect(screen.getByTestId("item-count")).toHaveTextContent("1")
    expect(cartClientMocks.getCart).toHaveBeenCalledOnce()
  })

  it("creates a cart only inside the first add-item request", async () => {
    const populatedCart = cartFixture("cart_new", [
      lineItemFixture("line-a", "variant-a"),
    ])
    cartClientMocks.addLineItem.mockResolvedValue(populatedCart)
    cartClientMocks.getCart
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(populatedCart)

    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false")
    })

    fireEvent.click(screen.getByRole("button", { name: "Add A" }))

    await waitFor(() => {
      expect(screen.getByTestId("item-count")).toHaveTextContent("1")
    })

    expect(cartClientMocks.addLineItem).toHaveBeenCalledWith("variant-a", 1)
  })

  it("serializes simultaneous first adds", async () => {
    const firstAdd = deferred<HttpTypes.StoreCart>()
    const firstCart = cartFixture("cart_new", [
      lineItemFixture("line-a", "variant-a"),
    ])
    const secondCart = cartFixture("cart_new", [
      lineItemFixture("line-a", "variant-a"),
      lineItemFixture("line-b", "variant-b"),
    ])
    cartClientMocks.addLineItem
      .mockReturnValueOnce(firstAdd.promise)
      .mockResolvedValueOnce(secondCart)
    cartClientMocks.getCart
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(firstCart)
      .mockResolvedValueOnce(secondCart)

    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false")
    })

    fireEvent.click(screen.getByRole("button", { name: "Add A" }))
    fireEvent.click(screen.getByRole("button", { name: "Add B" }))

    await waitFor(() => {
      expect(cartClientMocks.addLineItem).toHaveBeenCalledTimes(1)
    })
    firstAdd.resolve(firstCart)

    await waitFor(() => {
      expect(cartClientMocks.addLineItem).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId("item-count")).toHaveTextContent("2")
    })
  })

  it("serializes updates so confirmed responses cannot overtake", async () => {
    const firstUpdate = deferred<HttpTypes.StoreCart>()
    const existingCart = cartFixture("cart_existing", [
      lineItemFixture("line-a", "variant-a"),
      lineItemFixture("line-b", "variant-b"),
    ])
    const firstUpdatedCart = cartFixture("cart_existing", [
      lineItemFixture("line-a", "variant-a", 2),
      lineItemFixture("line-b", "variant-b"),
    ])
    const secondUpdatedCart = cartFixture("cart_existing", [
      lineItemFixture("line-a", "variant-a", 2),
      lineItemFixture("line-b", "variant-b", 2),
    ])
    cartClientMocks.getCart
      .mockResolvedValueOnce(existingCart)
      .mockResolvedValueOnce(firstUpdatedCart)
      .mockResolvedValueOnce(secondUpdatedCart)
    cartClientMocks.updateLineItem
      .mockReturnValueOnce(firstUpdate.promise)
      .mockResolvedValueOnce(secondUpdatedCart)

    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId("item-count")).toHaveTextContent("2")
    })

    fireEvent.click(screen.getByRole("button", { name: "Update A" }))
    fireEvent.click(screen.getByRole("button", { name: "Update B" }))

    await waitFor(() => {
      expect(cartClientMocks.updateLineItem).toHaveBeenCalledTimes(1)
    })
    firstUpdate.resolve(firstUpdatedCart)

    await waitFor(() => {
      expect(cartClientMocks.updateLineItem).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId("item-count")).toHaveTextContent("4")
    })
  })

  it("uses quantity zero as the remove contract", async () => {
    const existingCart = cartFixture("cart_existing", [
      lineItemFixture("line-a", "variant-a"),
    ])
    const emptyCart = cartFixture("cart_existing")
    cartClientMocks.getCart
      .mockResolvedValueOnce(existingCart)
      .mockResolvedValueOnce(emptyCart)
    cartClientMocks.updateLineItem.mockResolvedValue(emptyCart)

    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId("item-count")).toHaveTextContent("1")
    })

    fireEvent.click(screen.getByRole("button", { name: "Remove A with zero" }))

    await waitFor(() => {
      expect(screen.getByTestId("item-count")).toHaveTextContent("0")
    })
    expect(cartClientMocks.updateLineItem).toHaveBeenCalledWith("line-a", 0)
  })
})
