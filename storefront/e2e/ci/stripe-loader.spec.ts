import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { expect, type Page, test } from "@playwright/test"
import ts from "typescript"

const stripeRoot = dirname(dirname(require.resolve("@stripe/stripe-js")))
const pureLoader = readFileSync(join(stripeRoot, "dist/pure.js"), "utf8")
const dynamicPolicy = ts.transpileModule(
  readFileSync(
    join(__dirname, "../../src/lib/stripe-dynamic-script-policy.ts"),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText
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
const openLoaderFixture = async (
  page: Page,
  dynamic = false
): Promise<void> => {
  await page.route(fixtureUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      headers: {
        "content-security-policy": [
          "default-src 'none'",
          "img-src data:",
          "script-src 'nonce-stripe-loader-contract' https://js.stripe.com https://*.js.stripe.com",
          `trusted-types remorseless-stripe-js${dynamic ? " default" : ""}`,
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
            ${dynamic ? `(function (exports) { ${dynamicPolicy}; exports.installStripeDynamicScriptPolicy(); exports.installStripeDynamicScriptPolicy(); })({});` : ""}
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

test("Stripe loader permits its vendor's dynamic chunks without allowing other sinks", async ({
  page,
  browserName,
}) => {
  const requests: string[] = []
  await page.route(
    /^https:\/\/(?:[a-z0-9-]+\.)?js\.stripe\.com\//,
    async (route) => {
      requests.push(route.request().url())
      await route.fulfill({
        contentType: "application/javascript",
        body: "void 0;",
      })
    }
  )
  await openLoaderFixture(page, true)
  const result = await page.evaluate(async () => {
    const urls = [
      "https://js.stripe.com/v3/stripe-next-test.js",
      "https://b.js.stripe.com/v3/elements-test.js",
    ]
    await Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve, reject) => {
            const script = document.createElement("script")
            script.onload = () => resolve()
            script.onerror = () => reject(new Error("dynamic script failed"))
            script.src = url
            document.head.append(script)
          })
      )
    )
    if (!("trustedTypes" in window))
      return { enforced: false, blocked: [], objectSink: null }
    const operations = [
      () => {
        document.createElement("script").src =
          "https://js.stripe.com.attacker.test/chunk.js"
      },
      () => {
        document.createElement("script").src =
          "https://js.stripe.com@attacker.test/chunk.js"
      },
      () => {
        document.createElement("script").src =
          "https://js.stripe.com/chunk.js?callback=attack"
      },
      () => {
        document.createElement("script").src = "/local.js"
      },
      () => {
        document.createElement("div").innerHTML = "<img src=x onerror=alert(1)>"
      },
      () => {
        document.createElement("script").text = "alert(1)"
      },
      () => {
        document.createElement("object").data = urls[0]!
      },
    ]
    return {
      enforced: true,
      objectSink: (
        window.trustedTypes as {
          getPropertyType: (tag: string, property: string) => string | null
        }
      ).getPropertyType("object", "data"),
      blocked: operations.map((operation) => {
        try {
          operation()
          return false
        } catch (error) {
          return error instanceof TypeError
        }
      }),
    }
  })
  expect(requests.sort()).toEqual([
    "https://b.js.stripe.com/v3/elements-test.js",
    "https://js.stripe.com/v3/stripe-next-test.js",
  ])
  if (browserName === "chromium") expect(result.enforced).toBe(true)
  if (result.enforced) {
    expect(result.blocked.slice(0, 6)).toEqual(Array(6).fill(true))
    // Firefox/WebKit do not classify object.data as a Trusted Types sink.
    // The document still denies embedded objects through default-src 'none'.
    expect(result.blocked[6]).toBe(result.objectSink === "TrustedScriptURL")
  }
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
