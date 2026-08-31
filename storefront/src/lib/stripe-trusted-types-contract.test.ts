import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const stripeEntry = require.resolve("@stripe/stripe-js")
const stripeRoot = dirname(dirname(stripeEntry))

describe("pinned Stripe.js Trusted Types boundary", () => {
  it("allows only the pinned Stripe.js script URL through a named policy", () => {
    const packageJson = JSON.parse(
      readFileSync(join(stripeRoot, "package.json"), "utf8")
    ) as { version?: unknown }
    const commonJsSource = readFileSync(
      join(stripeRoot, "dist/index.js"),
      "utf8"
    )
    const esmSource = readFileSync(join(stripeRoot, "dist/index.mjs"), "utf8")

    expect(packageJson.version).toBe("9.12.0")
    for (const source of [commonJsSource, esmSource]) {
      expect(source).toContain("remorseless-stripe-js")
      expect(source).toContain("createStripeScriptURL")
      expect(source).toContain("candidate !== STRIPE_JS_URL")
      expect(source).toContain("?advancedFraudSignals=false")
      expect(source).toContain("Stripe.js URL is not trusted")
      expect(source).not.toContain(
        'script.src = "".concat(STRIPE_JS_URL).concat(queryString)'
      )
    }
  })
})
