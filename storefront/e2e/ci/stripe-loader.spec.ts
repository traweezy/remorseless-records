import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { expect, type Page, test } from "@playwright/test"

const stripeRoot = dirname(dirname(require.resolve("@stripe/stripe-js")))
const pureLoader = readFileSync(join(stripeRoot, "dist/pure.js"), "utf8")
const fixtureUrl = "https://stripe-loader.test/"
const scriptUrl = "https://js.stripe.com/dahlia/stripe.js"
const localStripeScript = `
  window.Stripe = Object.assign(function (key) {
    return { fixtureKey: key, _registerWrapper: function () {} };
  }, { version: 'dahlia' });
`

type LoaderWindow = Window & {
  stripeLoader: {
    loadStripe: {
      (key: string): Promise<{ fixtureKey: string }>
      setLoadParameters: (options: { advancedFraudSignals: boolean }) => void
    }
  }
  stripePolicyViolations: string[]
}

// Exercise the installed, patched loader under actual browser CSP enforcement.
// Both the fixture document and every Stripe request are fulfilled locally.
const openLoaderFixture = async (page: Page): Promise<void> => {
  await page.route(fixtureUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      headers: {
        "content-security-policy": [
          "default-src 'none'",
          "img-src data:",
          "script-src 'nonce-stripe-loader-contract' https://js.stripe.com",
          "trusted-types remorseless-stripe-js",
          "require-trusted-types-for 'script'",
        ].join("; "),
      },
      body: `<!doctype html><html lang="en"><head><title>Stripe loader contract</title>
        <link rel="icon" href="data:,"></head>
        <body><h1>Stripe loader contract</h1>
          <script nonce="stripe-loader-contract">
            window.stripePolicyViolations = [];
            document.addEventListener('securitypolicyviolation', function (event) {
              window.stripePolicyViolations.push(event.effectiveDirective);
            });
            window.stripeLoader = {};
            (function (exports) { ${pureLoader} })(window.stripeLoader);
          </script>
        </body></html>`,
    })
  })
  await page.goto(fixtureUrl)
  await expect(
    page.getByRole("heading", { name: "Stripe loader contract" })
  ).toBeVisible()
}

test("Stripe loader stays lazy and shares a trusted script across concurrent checkouts", async ({
  browserName,
  page,
}) => {
  const requests: string[] = []
  await page.route("https://js.stripe.com/**", async (route) => {
    requests.push(route.request().url())
    await route.fulfill({
      contentType: "application/javascript",
      body: localStripeScript,
    })
  })
  await openLoaderFixture(page)

  if (browserName === "chromium") {
    expect(await page.evaluate(() => "trustedTypes" in window)).toBe(true)
  }

  expect(requests).toEqual([])
  await expect(
    page.locator('script[src^="https://js.stripe.com"]')
  ).toHaveCount(0)

  const results = await page.evaluate(async () => {
    const loader = (window as LoaderWindow).stripeLoader.loadStripe
    loader.setLoadParameters({ advancedFraudSignals: false })
    return Promise.all([
      loader("pk_test_first"),
      loader("pk_test_second"),
    ]).then((instances) => instances.map(({ fixtureKey }) => fixtureKey))
  })

  expect(results).toEqual(["pk_test_first", "pk_test_second"])
  expect(requests).toEqual([`${scriptUrl}?advancedFraudSignals=false`])
  await expect(
    page.locator('script[src^="https://js.stripe.com"]')
  ).toHaveCount(1)
  expect(
    await page.evaluate(() => (window as LoaderWindow).stripePolicyViolations)
  ).toEqual([])
})

test("Stripe loader retries a failed trusted script without recreating its named policy", async ({
  page,
}) => {
  const requests: string[] = []
  await page.route("https://js.stripe.com/**", async (route) => {
    requests.push(route.request().url())
    if (requests.length === 1) {
      await route.abort("failed")
      return
    }
    await route.fulfill({
      contentType: "application/javascript",
      body: localStripeScript,
    })
  })
  await openLoaderFixture(page)

  const result = await page.evaluate(async () => {
    const loader = (window as LoaderWindow).stripeLoader.loadStripe
    const firstError = await loader("pk_test_retry").then(
      () => null,
      (error: unknown) =>
        error instanceof Error ? error.message : "Unexpected loader rejection"
    )
    const instance = await loader("pk_test_retry")
    return { firstError, fixtureKey: instance.fixtureKey }
  })

  expect(result).toEqual({
    firstError: "Failed to load Stripe.js",
    fixtureKey: "pk_test_retry",
  })
  expect(requests).toEqual([scriptUrl, scriptUrl])
  await expect(
    page.locator('script[src^="https://js.stripe.com"]')
  ).toHaveCount(1)
  expect(
    await page.evaluate(() => (window as LoaderWindow).stripePolicyViolations)
  ).toEqual([])
})
