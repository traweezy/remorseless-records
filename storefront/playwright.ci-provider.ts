const ciMedusaFixtureBaseURL = "http://127.0.0.1:4010"
const ciMedusaPublishableKey = "pk_ci_storefront_fixture_20260831"

export const ciMedusaFixtureWebServer = {
  command: "node scripts/ci-medusa-fixture.mjs",
  env: {
    CI_MEDUSA_FIXTURE_PORT: new URL(ciMedusaFixtureBaseURL).port || "4010",
    CI_MEDUSA_PUBLISHABLE_KEY: ciMedusaPublishableKey,
  },
  reuseExistingServer: true,
  timeout: 10_000,
  url: `${ciMedusaFixtureBaseURL}/live`,
} as const

export const ciStorefrontProviderEnv = {
  CI_MEDUSA_FIXTURE_URL: ciMedusaFixtureBaseURL,
  CI_MEDUSA_PUBLISHABLE_KEY: ciMedusaPublishableKey,
  MEDUSA_BACKEND_URL: ciMedusaFixtureBaseURL,
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: ciMedusaFixtureBaseURL,
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: ciMedusaPublishableKey,
  NEXT_PUBLIC_MEDUSA_URL: ciMedusaFixtureBaseURL,
} as const
