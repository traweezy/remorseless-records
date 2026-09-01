import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const apiMocks = vi.hoisted(() => ({
  getCheckoutStatus: vi.fn(),
}))
const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}))
vi.mock("@/features/checkout/api/checkout-api", () => apiMocks)
vi.mock("@/components/ui/smart-link", () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}))

import { CheckoutRecovery } from "@/features/checkout/components/checkout-recovery"

describe("CheckoutRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"))
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("restores a confirmed order after the browser leaves before receipt navigation", async () => {
    apiMocks.getCheckoutStatus.mockResolvedValue("order_confirmed")

    render(<CheckoutRecovery />)

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/checkout/confirmation")
    })
    expect(apiMocks.getCheckoutStatus).toHaveBeenCalledOnce()
    expect(routerMocks.replace).not.toHaveBeenCalledWith("/checkout")
  })

  it("waits through a finalizing state and never invites another payment", async () => {
    apiMocks.getCheckoutStatus
      .mockResolvedValueOnce("finalizing_order")
      .mockResolvedValueOnce("payment_processing")
      .mockResolvedValueOnce("order_confirmed")

    render(<CheckoutRecovery />)

    await waitFor(() => {
      expect(apiMocks.getCheckoutStatus).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(1_500)
    await vi.advanceTimersByTimeAsync(2_500)

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/checkout/confirmation")
    })
    expect(apiMocks.getCheckoutStatus).toHaveBeenCalledTimes(3)
    expect(routerMocks.replace).not.toHaveBeenCalledWith("/checkout")
  })

  it.each([
    "cart_active",
    "payment_action_required",
    "payment_failed",
  ] as const)("returns the definite %s state to checkout", async (status) => {
    apiMocks.getCheckoutStatus.mockResolvedValue(status)

    render(<CheckoutRecovery />)

    await waitFor(() => {
      expect(routerMocks.replace).toHaveBeenCalledWith("/checkout")
    })
    expect(routerMocks.replace).not.toHaveBeenCalledWith(
      "/checkout/confirmation"
    )
  })
})
