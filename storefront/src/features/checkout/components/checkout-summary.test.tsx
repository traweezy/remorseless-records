import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CheckoutSummary } from "@/features/checkout/components/checkout-summary"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"

const checkoutFixture = (): CheckoutProjection => ({
  state: "ready_for_payment",
  revision: `v1.${"a".repeat(43)}`,
  cart: {
    items: [
      {
        availableQuantity: 4,
        id: "cali_test",
        productHandle: "test-release",
        productTitle: "Test Release",
        quantity: 1,
        subtotal: 19.99,
        thumbnail: null,
        unitPrice: 19.99,
        variantTitle: "LP",
      },
    ],
    totals: {
      taxCollectionMode: "collect",
      currencyCode: "usd",
      subtotal: 19.99,
      discountTotal: 0,
      shippingTotal: 5,
      taxTotal: 0,
      total: 24.99,
    },
    contact: { email: "buyer@example.test" },
    deliveryAddress: null,
    shippingMethod: {
      id: "casm_test",
      name: "Standard",
      optionId: "so_test",
      amount: 5,
    },
  },
  payment: {
    provider: "stripe",
    clientSecret: "pi_test_secret_test",
    status: "pending",
    canRestart: false,
  },
  confirmation: null,
})

describe("CheckoutSummary", () => {
  afterEach(() => {
    cleanup()
  })

  it("edits item quantity in place without linking shoppers away", async () => {
    const onUpdateItem = vi.fn(() => Promise.resolve())

    render(
      <CheckoutSummary
        checkout={checkoutFixture()}
        onRemoveItem={vi.fn(() => Promise.resolve())}
        onUpdateItem={onUpdateItem}
      />
    )

    expect(
      screen.queryByRole("link", { name: "Edit cart" })
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase quantity of Test Release",
      })
    )

    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith("cali_test", 2)
    })
    expect(screen.getByText("$39.98")).toBeInTheDocument()
  })

  it("supports removing an item directly from the summary", async () => {
    const onRemoveItem = vi.fn(() => Promise.resolve())

    render(
      <CheckoutSummary
        checkout={checkoutFixture()}
        onRemoveItem={onRemoveItem}
        onUpdateItem={vi.fn(() => Promise.resolve())}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Remove Test Release" }))

    await waitFor(() => {
      expect(onRemoveItem).toHaveBeenCalledWith("cali_test")
    })
  })

  it("labels an explicit disabled decision without calling it an exemption", () => {
    const checkout = checkoutFixture()
    checkout.cart.totals.taxCollectionMode = "disabled"

    render(<CheckoutSummary checkout={checkout} />)

    expect(screen.getByText("Tax not collected")).toBeInTheDocument()
    expect(screen.getByText("$0.00")).toBeInTheDocument()
    expect(screen.queryByText(/exempt/i)).not.toBeInTheDocument()
  })
})
