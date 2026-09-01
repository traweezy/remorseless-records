import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const stripeEntry = require.resolve("@stripe/stripe-js")
const stripeRoot = dirname(dirname(stripeEntry))

describe("pinned Stripe.js Trusted Types boundary", () => {
  it("defers Stripe.js loading until a payable checkout needs it", () => {
    const paymentSection = readFileSync(
      join(
        process.cwd(),
        "src/features/checkout/components/payment-section.tsx"
      ),
      "utf8"
    )

    expect(paymentSection).toContain(
      'import { loadStripe } from "@stripe/stripe-js/pure"'
    )
    expect(paymentSection).not.toContain(
      'import { loadStripe } from "@stripe/stripe-js"'
    )
  })

  it("allows only the pinned Stripe.js script URL through a named policy", () => {
    const packageJson = JSON.parse(
      readFileSync(join(stripeRoot, "package.json"), "utf8")
    ) as { version?: unknown }
    const loaderSources = [
      "dist/index.js",
      "dist/index.mjs",
      "dist/pure.js",
      "dist/pure.mjs",
    ].map((sourcePath) => readFileSync(join(stripeRoot, sourcePath), "utf8"))

    expect(packageJson.version).toBe("9.12.0")
    for (const source of loaderSources) {
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
