import { afterEach, describe, expect, it, vi } from "vitest"

const loadCheckoutServerEnv = async () => {
  vi.resetModules()
  return import("@/config/env.checkout.server")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("checkoutServerEnv", () => {
  it("keeps optional checkout secrets in a dedicated server contract", async () => {
    vi.stubEnv(
      "CHECKOUT_BFF_SECRET",
      "0123456789abcdef0123456789abcdef"
    )
    vi.stubEnv(
      "CHECKOUT_RECEIPT_SECRET",
      "fedcba9876543210fedcba9876543210"
    )
    vi.stubEnv("MEDUSA_BACKEND_URL", "https://backend.test")

    const { checkoutServerEnv } = await loadCheckoutServerEnv()

    expect(checkoutServerEnv).toEqual({
      medusaBackendUrl: "https://backend.test",
      checkoutBffSecret: "0123456789abcdef0123456789abcdef",
      checkoutReceiptSecret: "fedcba9876543210fedcba9876543210",
    })
  })

  it("allows builds before staging activation", async () => {
    vi.stubEnv("CHECKOUT_BFF_SECRET", undefined)
    vi.stubEnv("CHECKOUT_RECEIPT_SECRET", undefined)

    const { checkoutServerEnv } = await loadCheckoutServerEnv()

    expect(checkoutServerEnv.checkoutBffSecret).toBeNull()
    expect(checkoutServerEnv.checkoutReceiptSecret).toBeNull()
  })

  it.each(["CHECKOUT_BFF_SECRET", "CHECKOUT_RECEIPT_SECRET"] as const)(
    "rejects a short %s",
    async (name) => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined)
      vi.stubEnv(name, "too-short")

      await expect(loadCheckoutServerEnv()).rejects.toThrow(
        "Checkout server environment validation failed"
      )
      expect(errorSpy).toHaveBeenCalled()
    }
  )
})
