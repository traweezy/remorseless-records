import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CheckoutCompletion } from "@/features/checkout/api/checkout-api"
import type { CheckoutProjection } from "@/features/checkout/types/checkout"

const stripeMocks = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  elementsSubmit: vi.fn(),
}))

vi.mock("@/config/env.client", () => ({
  clientEnv: {
    stripePublishableKey: "pk_test_component",
  },
}))

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}))

vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react")
  return {
    Elements: ({ children }: { children: React.ReactNode }) => children,
    PaymentElement: ({
      onChange,
      onReady,
    }: {
      onChange?: (event: { complete: boolean }) => void
      onReady?: () => void
    }) => {
      React.useEffect(() => {
        onReady?.()
        onChange?.({ complete: true })
      }, [onChange, onReady])
      return <div data-testid="payment-element" />
    },
    useElements: () => ({ submit: stripeMocks.elementsSubmit }),
    useStripe: () => ({ confirmPayment: stripeMocks.confirmPayment }),
  }
})

import { PaymentSection } from "@/features/checkout/components/payment-section"

const revision = `v1.${"a".repeat(43)}`

const checkoutFixture = ({
  clientSecret = "pi_test_secret_test",
  total = 24.99,
}: {
  clientSecret?: string | null
  total?: number
} = {}): CheckoutProjection => ({
  state: "ready_for_payment",
  revision,
  cart: {
    items: [
      {
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
      currencyCode: "usd",
      subtotal: 19.99,
      discountTotal: 0,
      shippingTotal: total === 0 ? 0 : 5,
      taxTotal: 0,
      total,
    },
    contact: { email: "buyer@example.test" },
    deliveryAddress: {
      firstName: "Ada",
      lastName: "Lovelace",
      address1: "123 Test St",
      address2: null,
      city: "Phoenix",
      province: "AZ",
      postalCode: "85001",
      countryCode: "us",
      phone: null,
    },
    shippingMethod: {
      id: "casm_test",
      name: "Standard",
      optionId: "so_test",
      amount: total === 0 ? 0 : 5,
    },
  },
  payment: {
    provider: clientSecret ? "stripe" : null,
    clientSecret,
    status: clientSecret ? "pending" : null,
    canRestart: false,
  },
  confirmation: null,
})

const completion: CheckoutCompletion = {
  state: "order_confirmed",
  confirmation: { orderNumber: "1042" },
}

describe("PaymentSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stripeMocks.elementsSubmit.mockResolvedValue({})
    stripeMocks.confirmPayment.mockResolvedValue({
      paymentIntent: { status: "succeeded" },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("synchronously blocks duplicate paid-order submissions", async () => {
    const checkout = checkoutFixture()
    const onPrepare = vi.fn(() => Promise.resolve(checkout))
    const onComplete = vi.fn(() => Promise.resolve(completion))
    const onConfirmed = vi.fn()

    render(
      <PaymentSection
        checkout={checkout}
        isPreparing={false}
        prepareError={null}
        onPrepare={onPrepare}
        onComplete={onComplete}
        onConfirmed={onConfirmed}
        onRecovery={vi.fn()}
      />
    )

    const button = await screen.findByRole("button", {
      name: "Place order — $24.99",
    })
    const form = button.closest("form")
    if (!form) {
      throw new Error("Expected payment form")
    }

    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledOnce()
    })
    expect(stripeMocks.elementsSubmit).toHaveBeenCalledOnce()
    expect(stripeMocks.confirmPayment).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("reconciles instead of inviting a retry after confirmation is uncertain", async () => {
    const checkout = checkoutFixture()
    const onRecovery = vi.fn()
    const onComplete = vi.fn(() => Promise.reject(new Error("response lost")))

    render(
      <PaymentSection
        checkout={checkout}
        isPreparing={false}
        prepareError={null}
        onPrepare={vi.fn(() => Promise.resolve(checkout))}
        onComplete={onComplete}
        onConfirmed={vi.fn()}
        onRecovery={onRecovery}
      />
    )

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Place order — $24.99",
      })
    )

    await waitFor(() => {
      expect(onRecovery).toHaveBeenCalledOnce()
    })
    expect(
      screen.queryByText(/check your connection and try again/i)
    ).not.toBeInTheDocument()
  })

  it("does not loop payment preparation after an error", async () => {
    const onPrepare = vi.fn(() => Promise.reject(new Error("offline")))

    render(
      <PaymentSection
        checkout={checkoutFixture({ clientSecret: null })}
        isPreparing={false}
        prepareError={null}
        onPrepare={onPrepare}
        onComplete={vi.fn(() => Promise.resolve(completion))}
        onConfirmed={vi.fn()}
        onRecovery={vi.fn()}
      />
    )

    expect(
      await screen.findByText(
        "Secure payment could not be prepared. Try again."
      )
    ).toBeInTheDocument()
    expect(onPrepare).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => {
      expect(onPrepare).toHaveBeenCalledTimes(2)
    })
  })

  it("synchronously blocks duplicate free-order submissions", async () => {
    let finish: ((value: CheckoutCompletion) => void) | undefined
    const onComplete = vi.fn(
      () =>
        new Promise<CheckoutCompletion>((resolve) => {
          finish = resolve
        })
    )
    const onConfirmed = vi.fn()

    render(
      <PaymentSection
        checkout={checkoutFixture({ clientSecret: null, total: 0 })}
        isPreparing={false}
        prepareError={null}
        onPrepare={vi.fn(() => Promise.resolve(checkoutFixture({ total: 0 })))}
        onComplete={onComplete}
        onConfirmed={onConfirmed}
        onRecovery={vi.fn()}
      />
    )

    const button = screen.getByRole("button", { name: "Place free order" })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onComplete).toHaveBeenCalledOnce()
    finish?.(completion)
    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalledOnce()
    })
  })
})
