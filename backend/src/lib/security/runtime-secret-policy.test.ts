import { validateBackendRuntimeSecrets } from "./runtime-secret-policy"

const strongSecret = (label: string): string =>
  `${label}-${"0123456789abcdef".repeat(3)}`

const productionEnvironment = (): NodeJS.ProcessEnv => ({
  JWT_SECRET: strongSecret("jwt"),
  COOKIE_SECRET: strongSecret("cookie"),
  CHECKOUT_BFF_SECRET: strongSecret("checkout"),
  PUBLIC_FORM_BFF_SECRET: strongSecret("public-form"),
  STRIPE_WEBHOOK_SECRET: strongSecret("stripe-official"),
})
describe("validateBackendRuntimeSecrets", () => {
  it("accepts distinct strong production secrets and optional prior keys", () => {
    expect(() =>
      validateBackendRuntimeSecrets({
        environment: {
          ...productionEnvironment(),
          CHECKOUT_BFF_SECRET_PREVIOUS: strongSecret("checkout-previous"),
          PUBLIC_FORM_BFF_SECRET_PREVIOUS: strongSecret("public-form-previous"),
          STRIPE_LIFECYCLE_WEBHOOK_SECRET: strongSecret("stripe-lifecycle"),
        },
        isProduction: true,
      })
    ).not.toThrow()
  })

  it.each([
    "JWT_SECRET",
    "COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "PUBLIC_FORM_BFF_SECRET",
  ] as const)("rejects a missing or weak %s", (name) => {
    expect(() =>
      validateBackendRuntimeSecrets({
        environment: { ...productionEnvironment(), [name]: "too-short" },
        isProduction: true,
      })
    ).toThrow(`${name} must contain at least 32 UTF-8 bytes`)
  })

  it("rejects placeholder and reused production secrets", () => {
    expect(() =>
      validateBackendRuntimeSecrets({
        environment: {
          ...productionEnvironment(),
          JWT_SECRET: "replace-this-placeholder-secret-value-now",
        },
        isProduction: true,
      })
    ).toThrow("JWT_SECRET must not contain a placeholder value")

    const environment = productionEnvironment()
    environment.COOKIE_SECRET = environment.JWT_SECRET
    expect(() =>
      validateBackendRuntimeSecrets({ environment, isProduction: true })
    ).toThrow("JWT_SECRET and COOKIE_SECRET must use distinct values")
  })

  it("does not impose production requirements on build and test commands", () => {
    expect(() =>
      validateBackendRuntimeSecrets({ environment: {}, isProduction: false })
    ).not.toThrow()
  })
})
