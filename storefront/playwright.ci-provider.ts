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
  CART_COOKIE_SECRET: "ci-runtime-cart-cookie-20260827-alpha",
  CHECKOUT_BFF_SECRET: "ci-runtime-checkout-bff-20260827-bravo",
  CHECKOUT_RECEIPT_SECRET: "ci-runtime-checkout-receipt-20260827-charlie",
  CI_MEDUSA_FIXTURE_URL: ciMedusaFixtureBaseURL,
  CI_MEDUSA_PUBLISHABLE_KEY: ciMedusaPublishableKey,
  MEDUSA_BACKEND_URL: ciMedusaFixtureBaseURL,
  // Never inherit repository-level staging search credentials in pre-deploy
  // browsers. An unavailable loopback endpoint exercises the deterministic
  // Medusa catalog fallback without fetching staging media through local Next.
  MEILISEARCH_HOST: "http://127.0.0.1:7700",
  MEILISEARCH_SEARCH_KEY: "ci-launch-search-key-20260831",
  NEXT_PUBLIC_MEDUSA_BACKEND_URL: ciMedusaFixtureBaseURL,
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: ciMedusaPublishableKey,
  NEXT_PUBLIC_MEDUSA_URL: ciMedusaFixtureBaseURL,
  PUBLIC_FORM_BFF_SECRET: "ci-runtime-public-form-bff-20260827-delta",
} as const
