import { describe, expect, it } from "vitest"

import { validateStorefrontRuntimeSecrets } from "./runtime-secret-policy"

const strongSecret = (label: string): string =>
  `${label}-${"0123456789abcdef".repeat(3)}`

const productionEnvironment = (): Record<string, string | undefined> => ({
  CART_COOKIE_SECRET: strongSecret("cart"),
  CHECKOUT_BFF_SECRET: strongSecret("checkout"),
  CHECKOUT_RECEIPT_SECRET: strongSecret("receipt"),
  PUBLIC_FORM_BFF_SECRET: strongSecret("public-form"),
})

describe("validateStorefrontRuntimeSecrets", () => {
  it("accepts distinct strong production secrets and prior cookie keys", () => {
    expect(() =>
      validateStorefrontRuntimeSecrets({
        environment: {
          ...productionEnvironment(),
          CART_COOKIE_SECRET_PREVIOUS: strongSecret("cart-previous"),
          CHECKOUT_RECEIPT_SECRET_PREVIOUS: strongSecret("receipt-previous"),
        },
        isProduction: true,
      })
    ).not.toThrow()
  })

  it.each([
    "CART_COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "CHECKOUT_RECEIPT_SECRET",
    "PUBLIC_FORM_BFF_SECRET",
  ] as const)("rejects a missing or weak %s", (name) => {
    expect(() =>
      validateStorefrontRuntimeSecrets({
        environment: { ...productionEnvironment(), [name]: "too-short" },
        isProduction: true,
      })
    ).toThrow(`${name} must contain at least 32 UTF-8 bytes`)
  })

  it("rejects placeholder and reused production secrets", () => {
    expect(() =>
      validateStorefrontRuntimeSecrets({
        environment: {
          ...productionEnvironment(),
          CART_COOKIE_SECRET: "replace-this-placeholder-secret-value-now",
        },
        isProduction: true,
      })
    ).toThrow("CART_COOKIE_SECRET must not contain a placeholder value")

    const environment = productionEnvironment()
    environment.CHECKOUT_RECEIPT_SECRET = environment.CHECKOUT_BFF_SECRET
    expect(() =>
      validateStorefrontRuntimeSecrets({ environment, isProduction: true })
    ).toThrow(
      "CHECKOUT_BFF_SECRET and CHECKOUT_RECEIPT_SECRET must use distinct values"
    )
  })

  it("does not impose production requirements on build and test commands", () => {
    expect(() =>
      validateStorefrontRuntimeSecrets({
        environment: {},
        isProduction: false,
      })
    ).not.toThrow()
  })
})
