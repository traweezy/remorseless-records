import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  createCiMedusaFixtureServer,
  defaultCiMedusaPublishableKey,
} from "./ci-medusa-fixture.mjs"

const withFixture = async (callback) => {
  const fixture = createCiMedusaFixtureServer({ port: 0 })
  const baseUrl = await fixture.listen()
  try {
    await callback(baseUrl)
  } finally {
    await fixture.close()
  }
}

const fixtureFetch = (baseUrl, pathname, init = {}) =>
  fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "x-publishable-api-key": defaultCiMedusaPublishableKey,
      ...init.headers,
    },
  })

test("serves deterministic authenticated catalog projections", async () => {
  await withFixture(async (baseUrl) => {
    const live = await fetch(`${baseUrl}/live`)
    assert.equal(live.status, 200)

    const unauthorized = await fetch(`${baseUrl}/store/products`)
    assert.equal(unauthorized.status, 401)

    const productsResponse = await fixtureFetch(
      baseUrl,
      "/store/products?handle=music-release-pathologist-pathological-decomposition"
    )
    assert.equal(productsResponse.status, 200)
    const products = await productsResponse.json()
    assert.equal(products.count, 1)
    assert.equal(
      products.products[0].variants[0].calculated_price.currency_code,
      "usd"
    )

    const shelvesResponse = await fixtureFetch(
      baseUrl,
      "/store/catalog/shelves"
    )
    const shelves = await shelvesResponse.json()
    assert.deepEqual(
      shelves.shelves.map((entry) => entry.shelf.handle),
      ["featured", "new-releases", "staff-picks"]
    )
    assert.equal(
      shelves.shelves.reduce(
        (total, entry) => total + entry.productIds.length,
        0
      ),
      2
    )

    const handlesResponse = await fixtureFetch(
      baseUrl,
      "/store/products/handles?limit=100"
    )
    const handles = await handlesResponse.json()
    assert.equal(handles.handles.length, 1)
    assert.equal(handles.next_cursor, null)

    const discographyResponse = await fixtureFetch(
      baseUrl,
      "/store/discography?limit=200&offset=0"
    )
    const discography = await discographyResponse.json()
    assert.equal(discography.count, 1)
    assert.equal(discography.entries[0].linkHealth, "healthy")
  })
})

test("fails closed for unsupported methods and routes", async () => {
  await withFixture(async (baseUrl) => {
    const mutation = await fixtureFetch(baseUrl, "/store/products", {
      method: "POST",
    })
    assert.equal(mutation.status, 405)
    assert.equal(mutation.headers.get("allow"), "GET, HEAD")

    const unknown = await fixtureFetch(baseUrl, "/store/unknown")
    assert.equal(unknown.status, 404)
    assert.deepEqual(await unknown.json(), { code: "fixture_route_not_found" })
  })
})

test("pins Browser Smoke to the local fixture before deployment", () => {
  const workflow = fs.readFileSync(".github/workflows/storefront.yml", "utf8")
  const ciConfig = fs.readFileSync("storefront/playwright.ci.config.ts", "utf8")
  const criticalConfig = fs.readFileSync(
    "storefront/playwright.critical.config.ts",
    "utf8"
  )
  const launchConfig = fs.readFileSync(
    "storefront/playwright.launch.config.ts",
    "utf8"
  )
  const providerConfig = fs.readFileSync(
    "storefront/playwright.ci-provider.ts",
    "utf8"
  )
  const lighthouseConfig = fs.readFileSync("lighthouse/lhci.config.js", "utf8")

  assert.match(workflow, /CI_MEDUSA_FIXTURE_URL: http:\/\/127\.0\.0\.1:4010/u)
  assert.match(workflow, /Start deterministic Medusa fixture/u)
  assert.match(workflow, /Stop deterministic Medusa fixture/u)
  assert.doesNotMatch(
    workflow.match(/  e2e:[\s\S]*?\n  accessibility:/u)?.[0] ?? "",
    /secrets\.MEDUSA_BACKEND_URL/u
  )
  assert.match(ciConfig, /ciMedusaFixtureWebServer/u)
  assert.match(criticalConfig, /ciMedusaFixtureWebServer/u)
  assert.match(launchConfig, /ciMedusaFixtureWebServer/u)
  assert.match(launchConfig, /MEILISEARCH_HOST: "http:\/\/127\.0\.0\.1:7700"/u)
  assert.doesNotMatch(
    launchConfig,
    /process\.env\.MEILISEARCH_(?:HOST|SEARCH_KEY)/u
  )
  for (const secretName of [
    "CART_COOKIE_SECRET",
    "CHECKOUT_BFF_SECRET",
    "CHECKOUT_RECEIPT_SECRET",
    "PUBLIC_FORM_BFF_SECRET",
  ]) {
    assert.match(providerConfig, new RegExp(`${secretName}: ".{32,}"`, "u"))
  }
  assert.match(
    workflow.match(/  lighthouse:[\s\S]*$/u)?.[0] ?? "",
    /Start deterministic Medusa fixture/u
  )
  assert.match(lighthouseConfig, /numberOfRuns: configuredRuns/u)
  assert.match(lighthouseConfig, /largest-contentful-paint/u)
  assert.match(lighthouseConfig, /resource-summary:total:count/u)
  assert.match(lighthouseConfig, /target: "filesystem"/u)
})
