import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
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

    expect(packageJson.version).toBe("9.14.0")
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

  it("rejects spoofed Stripe hosts in the built-client verifier", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "rr-stripe-loader-"))
    const staticDirectory = join(fixtureRoot, ".next", "static")
    mkdirSync(staticDirectory, { recursive: true })

    try {
      for (const [origin, expectedStatus] of [
        ["https://js.stripe.com", 0],
        ["https://js.stripe.com.attacker.test", 1],
        ["https://js.stripe.com@attacker.test", 1],
        ["https://attacker.test/js.stripe.com", 1],
      ] as const) {
        writeFileSync(
          join(staticDirectory, "loader.js"),
          `${JSON.stringify(origin)};advancedFraudSignals;remorseless-stripe-js;remorseless-json-ld`
        )
        const result = spawnSync(
          process.execPath,
          [join(process.cwd(), "scripts", "verify-client-bundle-secrets.mjs")],
          { cwd: fixtureRoot, encoding: "utf8" }
        )
        expect(result.status, result.stderr).toBe(expectedStatus)
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
