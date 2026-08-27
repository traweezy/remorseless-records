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
    const bffSecret = ["bff", "unit", "test", "value"].join("-").repeat(2)
    const receiptSecret = ["receipt", "unit", "test", "value"]
      .join("-")
      .repeat(2)
    const previousReceiptSecret = ["receipt", "previous", "unit", "test"]
      .join("-")
      .repeat(2)
    vi.stubEnv("CHECKOUT_BFF_SECRET", bffSecret)
    vi.stubEnv("CHECKOUT_RECEIPT_SECRET", receiptSecret)
    vi.stubEnv("CHECKOUT_RECEIPT_SECRET_PREVIOUS", previousReceiptSecret)
    vi.stubEnv("MEDUSA_BACKEND_URL", "https://backend.test")

    const { checkoutServerEnv } = await loadCheckoutServerEnv()

    expect(checkoutServerEnv).toEqual({
      medusaBackendUrl: "https://backend.test",
      checkoutBffSecret: bffSecret,
      checkoutReceiptSecret: receiptSecret,
      checkoutReceiptSecretPrevious: previousReceiptSecret,
    })
  })

  it("allows builds before staging activation", async () => {
    vi.stubEnv("CHECKOUT_BFF_SECRET", undefined)
    vi.stubEnv("CHECKOUT_RECEIPT_SECRET", undefined)
    vi.stubEnv("CHECKOUT_RECEIPT_SECRET_PREVIOUS", undefined)

    const { checkoutServerEnv } = await loadCheckoutServerEnv()

    expect(checkoutServerEnv.checkoutBffSecret).toBeNull()
    expect(checkoutServerEnv.checkoutReceiptSecret).toBeNull()
    expect(checkoutServerEnv.checkoutReceiptSecretPrevious).toBeNull()
  })

  it.each([
    "CHECKOUT_BFF_SECRET",
    "CHECKOUT_RECEIPT_SECRET",
    "CHECKOUT_RECEIPT_SECRET_PREVIOUS",
  ] as const)(
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
