import {
  assertOperationalCapabilities,
  resolveOperationalCapabilities,
} from "./capabilities"

const completeEnvironment = {
  MEDUSA_FF_RBAC: "true",
  MEILISEARCH_ADMIN_KEY: "search-key",
  MEILISEARCH_HOST: "https://search.example.test",
  MINIO_ACCESS_KEY: "access-key",
  MINIO_ENDPOINT: "https://objects.example.test",
  MINIO_SECRET_KEY: "secret-key",
  RESEND_API_KEY: "resend-key",
  RESEND_FROM: "records@example.test",
  STRIPE_API_KEY: "sk_test_example",
  STRIPE_LIFECYCLE_WEBHOOK_SECRET: "whsec_lifecycle",
  STRIPE_PAYMENT_METHOD_CONFIGURATION: "pmc_test_example",
  STRIPE_TAX_SHIPPING_TAX_CODE: "txcd_92010001",
  STRIPE_WEBHOOK_SECRET: "whsec_payment",
  TAX_RATE_LOOKUP_API_KEY: "tax-key",
  TAX_RATE_LOOKUP_MODE: "zip",
  TAX_RATE_LOOKUP_PROVIDER: "taxrate_io",
}

describe("operational capability readiness", () => {
  it("accepts a complete provider configuration without exposing values", () => {
    const checks = resolveOperationalCapabilities(completeEnvironment)

    expect(checks).toHaveLength(7)
    expect(checks.every((check) => check.ready)).toBe(true)
    expect(JSON.stringify(checks)).not.toContain("secret-key")
    expect(JSON.stringify(checks)).not.toContain("search-key")
  })

  it("reports each incomplete capability with a bounded reason", () => {
    const checks = resolveOperationalCapabilities({})

    expect(checks.every((check) => !check.ready)).toBe(true)
    expect(new Set(checks.map(({ reason }) => reason))).toEqual(
      new Set(["configuration_incomplete"])
    )
  })

  it("fails startup when a required capability is incomplete", () => {
    expect(() =>
      assertOperationalCapabilities({
        environment: { ...completeEnvironment, RESEND_API_KEY: "" },
        required: true,
      })
    ).toThrow("notification")
  })

  it("permits incomplete optional development capabilities", () => {
    expect(
      assertOperationalCapabilities({ environment: {}, required: false })
    ).toHaveLength(7)
  })
})
