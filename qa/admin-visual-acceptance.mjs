import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute } from "node:path"

import { startAdminStaticServer } from "./admin-static-server.mjs"

const require = createRequire(new URL("../package.json", import.meta.url))
const puppeteer = require("puppeteer")
const { AxePuppeteer } = require("@axe-core/puppeteer")

const configuredBaseUrl = process.env.ADMIN_ACCEPTANCE_BASE_URL?.trim()
const staticServer = configuredBaseUrl ? null : await startAdminStaticServer()
const baseUrl = configuredBaseUrl ?? staticServer?.baseUrl
if (!baseUrl) {
  throw new Error("The Admin acceptance origin is unavailable.")
}
const acceptanceOrigin = new URL(baseUrl).origin
const route = process.env.ADMIN_ACCEPTANCE_ROUTE ?? "/app/catalog-authoring"
const screenshotPath =
  process.env.ADMIN_ACCEPTANCE_SCREENSHOT ??
  "/tmp/remorseless-admin-fixture.png"
const width = Number(process.env.ADMIN_ACCEPTANCE_WIDTH ?? "1600")
const height = Number(process.env.ADMIN_ACCEPTANCE_HEIGHT ?? "1000")
const holdMs = Number(process.env.ADMIN_ACCEPTANCE_HOLD_MS ?? "0")
const settleMs = Number(process.env.ADMIN_ACCEPTANCE_SETTLE_MS ?? "3000")
const clickText = process.env.ADMIN_ACCEPTANCE_CLICK ?? ""
const setup = process.env.ADMIN_ACCEPTANCE_SETUP ?? ""
const axeInclude = process.env.ADMIN_ACCEPTANCE_AXE_INCLUDE ?? "main"
const browserExecutable =
  process.env.ADMIN_ACCEPTANCE_BROWSER?.trim() ||
  ["/usr/bin/helium", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(
    (candidate) => existsSync(candidate)
  )

if (!browserExecutable) {
  await staticServer?.close()
  throw new Error(
    "No supported graphical Chromium executable is available for Admin acceptance."
  )
}
if (!route.startsWith("/app/") || route.includes("..")) {
  await staticServer?.close()
  throw new TypeError(
    "ADMIN_ACCEPTANCE_ROUTE must be an Admin application path."
  )
}
if (
  !Number.isInteger(width) ||
  width < 320 ||
  width > 3_840 ||
  !Number.isInteger(height) ||
  height < 480 ||
  height > 2_160 ||
  !Number.isFinite(holdMs) ||
  holdMs < 0 ||
  holdMs > 300_000 ||
  !Number.isFinite(settleMs) ||
  settleMs < 500 ||
  settleMs > 30_000 ||
  !isAbsolute(screenshotPath)
) {
  await staticServer?.close()
  throw new TypeError(
    "Admin acceptance dimensions, hold, or screenshot path are invalid."
  )
}

const timestamp = "2026-08-30T12:00:00.000Z"
const mediaFixtureUrl = "https://assets.acceptance.invalid/fixture-cover.svg"
const mediaFixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#17171a"/><circle cx="48" cy="48" r="32" fill="#f59e0b"/><circle cx="48" cy="48" r="11" fill="#17171a"/><text x="48" y="89" fill="#ffffff" font-family="sans-serif" font-size="10" text-anchor="middle">RR</text></svg>`
const product = {
  created_at: timestamp,
  description:
    "A fixture release used only for rendered Admin acceptance. No staging data is changed.",
  handle: "ashes-of-the-last-sun",
  id: "product_acceptance",
  status: "published",
  thumbnail: null,
  title: "Ashes of the Last Sun",
  updated_at: timestamp,
  variants: [
    {
      calculated_price: {
        calculated_amount: 2400,
        currency_code: "usd",
        original_amount: 2400,
      },
      id: "variant_acceptance",
      inventory_quantity: 18,
      manage_inventory: true,
      options: { Format: "Black Vinyl" },
      prices: [{ amount: 2400, currency_code: "usd", id: "price_acceptance" }],
      sku: "RR-001-BLK",
      title: "Black Vinyl",
    },
  ],
}

const paged = (key, values = []) => ({
  [key]: values,
  count: values.length,
  limit: 20,
  offset: 0,
})

const listKeyByPath = new Map([
  ["/admin/api-keys", "api_keys"],
  ["/admin/campaigns", "campaigns"],
  ["/admin/collections", "collections"],
  ["/admin/customer-groups", "customer_groups"],
  ["/admin/customers", "customers"],
  ["/admin/inventory-items", "inventory_items"],
  ["/admin/notifications", "notifications"],
  ["/admin/orders", "orders"],
  ["/admin/price-lists", "price_lists"],
  ["/admin/product-categories", "product_categories"],
  ["/admin/product-tags", "product_tags"],
  ["/admin/product-types", "product_types"],
  ["/admin/product-variants", "variants"],
  ["/admin/promotions", "promotions"],
  ["/admin/regions", "regions"],
  ["/admin/return-reasons", "return_reasons"],
  ["/admin/sales-channels", "sales_channels"],
  ["/admin/shipping-profiles", "shipping_profiles"],
  ["/admin/stock-locations", "stock_locations"],
  ["/admin/tax-regions", "tax_regions"],
  ["/admin/users", "users"],
])

const fixtureFor = (url) => {
  const { pathname } = url
  if (pathname === "/admin/users/me") {
    return {
      user: {
        avatar_url: null,
        created_at: timestamp,
        email: "acceptance@example.invalid",
        first_name: "Acceptance",
        id: "user_acceptance",
        last_name: "Operator",
        metadata: {},
        updated_at: timestamp,
      },
    }
  }
  if (pathname === "/admin/feature-flags") {
    return { feature_flags: { rbac: false } }
  }
  if (pathname === "/admin/stores") {
    return {
      stores: [
        {
          created_at: timestamp,
          default_location_id: null,
          default_region_id: null,
          default_sales_channel_id: null,
          id: "store_acceptance",
          metadata: {},
          name: "Remorseless Records",
          supported_currencies: [],
          updated_at: timestamp,
        },
      ],
    }
  }
  if (
    pathname.startsWith("/admin/layouts/") &&
    pathname.endsWith("/configuration")
  ) {
    return { configuration: null }
  }
  if (pathname === "/admin/layouts/configurations") {
    return paged("configurations")
  }
  if (pathname.startsWith("/admin/views/")) {
    return { columns: [], configurations: [], view: null, views: [] }
  }
  if (
    pathname === "/admin/products" ||
    pathname === "/admin/products/product_acceptance"
  ) {
    return pathname === "/admin/products"
      ? paged("products", [product])
      : { product }
  }
  if (pathname === "/admin/catalog/artists") {
    return {
      artists: [
        {
          id: "artist_acceptance",
          name: "Test Artist",
          slug: "test-artist",
          sortName: "Artist, Test",
        },
      ],
      count: 1,
      limit: 500,
      offset: 0,
    }
  }
  if (pathname === "/admin/catalog/reference-values") {
    return {
      values: [
        {
          id: "reference_type_music_release",
          isActive: true,
          kind: "product_type",
          label: "Music release",
          value: "music-release",
        },
        {
          id: "reference_format_cd",
          isActive: true,
          kind: "format",
          label: "CD",
          value: "cd",
        },
        {
          id: "reference_format_cassette",
          isActive: true,
          kind: "format",
          label: "Cassette",
          value: "cassette",
        },
        {
          id: "reference_format_vinyl",
          isActive: true,
          kind: "format",
          label: "Vinyl",
          value: "vinyl",
        },
        {
          id: "reference_format_detail_black",
          isActive: true,
          kind: "format_detail",
          label: "Black Shell",
          value: "black-shell",
        },
        {
          id: "reference_genre_black_metal",
          isActive: true,
          kind: "genre",
          label: "Black Metal",
          value: "black-metal",
        },
      ],
      count: 6,
      limit: 500,
      offset: 0,
    }
  }
  if (pathname === "/admin/catalog/authoring-audit") {
    return {
      filteredCount: 462,
      generatedAt: timestamp,
      items: [],
      limit: 1,
      offset: 0,
      summary: {
        blockingItemCount: 0,
        byKind: {
          fixed_bundle: 14,
          merch: 5,
          music_release: 442,
          mystery_bundle: 1,
        },
        byStatus: { classified: 462, conflict: 0, needs_review: 0 },
        issueCounts: { native_product_type_missing: 462 },
        total: 462,
      },
    }
  }
  if (pathname === "/admin/catalog/products/product_acceptance/profile") {
    return {
      artists: [
        {
          artistId: "artist_acceptance",
          displayName: "Test Artist",
          id: "product_artist_acceptance",
          role: "primary",
          sortOrder: 0,
        },
      ],
      profile: {
        credits: { production: "Test Engineer" },
        descriptionHtml: "<p>Fixture release description.</p>",
        id: "profile_acceptance",
        labelId: null,
        merchDetails: {},
        metadata: {},
        pressingNotes: { color: "Black" },
        productId: "product_acceptance",
        productTypeId: null,
        releaseDate: "2026-08-30T12:00:00.000Z",
        releaseTitle: "Ashes of the Last Sun",
        releaseYear: 2026,
        searchKeywords: ["black metal", "vinyl"],
        tracklist: [{ title: "Nocturne I" }, { title: "Nocturne II" }],
        version: 3,
      },
      references: [
        {
          id: "product_reference_acceptance",
          kind: "genre",
          referenceValueId: "reference_genre_black_metal",
          sortOrder: 0,
        },
      ],
    }
  }
  if (
    pathname === "/admin/catalog/products/product_acceptance/authoring-view"
  ) {
    return {
      view: {
        catalog: {
          artists: [
            {
              artist: { id: "artist_acceptance", name: "Test Artist" },
              assignment: { displayName: "Test Artist", role: "primary" },
            },
          ],
          bundle: null,
          label: null,
          media: [],
          productType: {
            id: "reference_type_music_release",
            label: "Music release",
          },
          profile: {
            id: "profile_acceptance",
            releaseDate: "2026-08-30T12:00:00.000Z",
            releaseDatePrecision: "day",
            releaseTitle: "Ashes of the Last Sun",
            releaseYear: 2026,
          },
          variants: [
            {
              format: {
                id: "reference_format_vinyl",
                label: "Vinyl",
              },
              formatDetail: null,
              status: {
                customerStatus: "in_stock",
                inventoryQuantity: 18,
                inventoryStatus: "in_stock",
                reason: "18 units are currently available.",
              },
              variantId: "variant_acceptance",
            },
          ],
        },
        classification: {
          issues: [],
          kind: "music_release",
          status: "classified",
        },
        commerce: {
          handle: product.handle,
          id: product.id,
          status: product.status,
          title: product.title,
          variants: product.variants.map(({ id, title }) => ({ id, title })),
        },
        diagnostics: {
          duplicateBundleProfileIds: [],
          duplicateProductProfileIds: [],
          inventoryAvailability: "available",
          missingArtistIds: [],
          missingMediaAssetIds: [],
          missingReferenceValueIds: [],
          missingVariantProfileIds: [],
          orphanVariantProfileIds: [],
        },
      },
    }
  }
  if (pathname === "/admin/catalog/products/product_acceptance/bundle") {
    return { bundle: null, components: [] }
  }
  if (pathname === "/admin/catalog/variants/variant_acceptance/profile") {
    return {
      profile: {
        availabilityStatus: "in_stock",
        backorderAllowed: false,
        backorderNote: null,
        displayLabel: "Black Vinyl",
        formatDetailId: null,
        formatDetailLabel: null,
        formatId: "reference_format_vinyl",
        formatLabel: "Vinyl",
        id: "variant_profile_acceptance",
        imageUrl: null,
        preorderReleaseDate: null,
        productProfileId: "profile_acceptance",
        variantId: "variant_acceptance",
        version: 2,
      },
    }
  }
  if (pathname === "/admin/catalog/shelves") {
    return {
      count: 1,
      limit: 100,
      offset: 0,
      shelves: [
        {
          products: [
            {
              endsAt: null,
              id: "shelf_product_acceptance",
              isPinned: true,
              productId: "product_acceptance",
              productProfileId: "profile_acceptance",
              shelfId: "shelf_acceptance",
              sortOrder: 0,
              startsAt: null,
            },
          ],
          shelf: {
            archivedAt: null,
            automationType: "none",
            description: "Featured releases for the storefront home page.",
            endsAt: null,
            handle: "featured-releases",
            id: "shelf_acceptance",
            isActive: true,
            mode: "manual",
            productLimit: 12,
            ribbonLabel: "Featured",
            ribbonPriority: 10,
            showRibbon: true,
            startsAt: null,
            title: "Featured releases",
            version: 4,
          },
        },
      ],
    }
  }
  if (pathname === "/admin/catalog/shelves/shelf_acceptance") {
    return fixtureFor(new URL(`${baseUrl}/admin/catalog/shelves`)).shelves[0]
  }
  if (pathname === "/admin/news") {
    return { count: 0, entries: [], limit: 25, offset: 0 }
  }
  if (pathname === "/admin/discography") {
    return { count: 0, entries: [], limit: 25, offset: 0 }
  }
  if (pathname === "/admin/catalog/media/orphans") {
    return {
      assets: [
        {
          byteSize: 1843200,
          createdAt: timestamp,
          id: "media_acceptance",
          lifecycleStatus: "active",
          mimeType: "image/jpeg",
          originalFilename: "fixture-cover.jpg",
          purgeEligibleAt: null,
          quarantinedAt: null,
          quarantinedBy: null,
          sourceFileKey: "acceptance/fixture-cover.jpg",
          sourceUrl: mediaFixtureUrl,
          version: 2,
        },
      ],
      count: 1,
      hasMore: false,
      limit: 25,
      offset: 0,
    }
  }
  if (pathname === "/admin/refund-operations") {
    return {
      cases: [],
      generatedAt: timestamp,
      reasonConfiguration: { configured: true, count: 5 },
      source: {
        evidenceScanned: 0,
        ordersScanned: 0,
        truncated: false,
        windowDays: 30,
      },
      summary: {
        actionRequired: 0,
        amountsByCurrency: [],
        processing: 0,
        totalCases: 0,
        verified: 0,
      },
    }
  }
  if (pathname === "/admin/tax-records") {
    return {
      destinations: [],
      filingState: "CT",
      filters: {
        collectionModes: ["collect", "disabled", "unknown"],
        currencies: [],
        providers: [
          "legacy",
          "mixed",
          "not_applicable",
          "stripe_tax",
          "taxrate_io",
          "unknown",
        ],
        states: [],
      },
      generatedAt: timestamp,
      period: {
        endDate: "2026-10-01",
        endExclusive: "2026-10-01T04:00:00.000Z",
        label: "Jul 1 – Sep 30, 2026",
        startDate: "2026-07-01",
        startInclusive: "2026-07-01T04:00:00.000Z",
        timeZone: "America/New_York",
      },
      records: [],
      resultCount: 0,
      source: {
        medusaOrdersScanned: 0,
        scopedRecords: 0,
        truncated: false,
        unassignedStateRecords: 0,
      },
      summaries: [
        {
          completeRecords: 0,
          currencyCode: "usd",
          disabledRecordCount: 0,
          grossSales: "0.00",
          incompleteRecords: 0,
          netSales: "0.00",
          netTax: "0.00",
          nontaxableSales: "0.00",
          orderCount: 0,
          priorPeriodRefundCount: 0,
          refundCount: 0,
          refundedSales: "0.00",
          refundedTax: "0.00",
          reviewRecords: 0,
          samePeriodRefundCount: 0,
          taxCollected: "0.00",
          taxableSales: "0.00",
          unclassifiedSales: "0.00",
        },
      ],
      unassignedRecordExamples: [],
    }
  }
  if (pathname === "/admin/tax-control") {
    const ready = {
      checks: [
        {
          detail: "Configured for acceptance.",
          id: "config",
          label: "Configuration",
          ready: true,
        },
      ],
      configured: true,
      message: "Ready",
      ready: true,
    }
    return {
      audits: [],
      control: {
        activeProvider: "taxrate_io",
        collectionMode: "disabled",
        generation: 3,
        lastSwitchReason: "Client requested tax collection remain off.",
        lastSwitchedAt: timestamp,
        lastSwitchedBy: "user_acceptance",
      },
      evidence: {
        incidents: [],
        needsAttention: 0,
        pendingRefundReversals: 0,
        prepared: 0,
        refundLedger: {
          available: true,
          checked: 0,
          mismatches: 0,
          truncated: false,
        },
        refunds: 0,
        succeeded: 0,
        tracked: 0,
      },
      impact: {
        activityWindowDays: 30,
        frozenByCollectionMode: { collect: 0, disabled: 12 },
        frozenByProvider: { stripe_tax: 0, taxrate_io: 0 },
        paymentsFinalizing: 0,
        preparedCheckouts: 0,
      },
      providers: {
        stripeTax: {
          ...ready,
          accountMode: "sandbox",
          activeRegistrationCount: 1,
          missingFields: [],
        },
        taxRateIo: {
          ...ready,
          manualRefreshConfigured: true,
          quota: {
            observedAt: timestamp,
            quota: 1000,
            remaining: 920,
            source: "fixture",
            usage: 80,
            usagePercent: 8,
          },
        },
      },
    }
  }
  const listKey = listKeyByPath.get(pathname)
  if (listKey) {
    return paged(listKey)
  }
  return {}
}

let browser

try {
  browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      `--window-size=${width},${height}`,
    ],
    defaultViewport: { height, width },
    executablePath: browserExecutable,
    headless: process.env.ADMIN_ACCEPTANCE_HEADFUL !== "1",
  })
  await mkdir(dirname(screenshotPath), { recursive: true })
  const page = await browser.newPage()
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ])
  const issues = []
  const failedResponses = []
  const fixtureRequests = new Map()
  page.on("console", (message) => {
    if (message.type() === "error") {
      issues.push(`console:${message.text()}`)
    }
  })
  page.on("pageerror", (error) => issues.push(`page:${error.message}`))
  page.on("requestfailed", (request) => {
    const url = new URL(request.url())
    issues.push(
      `request:${url.pathname}:${request.failure()?.errorText ?? "failed"}`
    )
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      })
    }
  })

  await page.setRequestInterception(true)
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.href === mediaFixtureUrl && request.method() === "GET") {
      void request.respond({
        body: mediaFixtureSvg,
        contentType: "image/svg+xml",
        headers: { "cache-control": "no-store" },
        status: 200,
      })
      return
    }
    if (
      request.method() === "OPTIONS" &&
      (url.pathname.startsWith("/admin/") || url.pathname === "/cloud/auth")
    ) {
      void request.respond({
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-headers":
            "authorization,content-type,x-medusa-locale,x-publishable-api-key",
          "access-control-allow-methods": "GET,HEAD,OPTIONS",
          "access-control-allow-origin": acceptanceOrigin,
          "cache-control": "no-store",
        },
        status: 204,
      })
      return
    }
    if (url.pathname.startsWith("/admin/") && request.method() === "GET") {
      fixtureRequests.set(
        url.pathname,
        (fixtureRequests.get(url.pathname) ?? 0) + 1
      )
      void request.respond({
        body: JSON.stringify(fixtureFor(url)),
        contentType: "application/json",
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-origin": acceptanceOrigin,
          "cache-control": "no-store",
        },
        status: 200,
      })
      return
    }
    if (url.pathname === "/cloud/auth" && request.method() === "GET") {
      void request.respond({
        body: "{}",
        contentType: "application/json",
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-origin": acceptanceOrigin,
        },
        status: 200,
      })
      return
    }
    void request.continue()
  })

  await page.goto(`${baseUrl}${route}`, {
    timeout: 30_000,
    waitUntil: "domcontentloaded",
  })
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  const clickButton = async (label) => {
    const buttons = await page.$$("button")
    for (const button of buttons) {
      const text = await button.evaluate((element) =>
        (element.textContent ?? "").trim()
      )
      if (text === label) {
        await button.click()
        return
      }
    }
    throw new Error(`Could not find ${label} button.`)
  }
  if (setup === "catalog-create-offerings") {
    await clickButton("Continue")
    await page.waitForSelector("#catalog-create-title")
    await page.type("#catalog-create-title", "Acceptance Release")
    await page.type("#catalog-create-artist", "Test Artist")
    await clickButton("Continue")
    await page.waitForSelector("#catalog-create-add-offering")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  if (setup === "catalog-create-validation") {
    await clickButton("Continue")
    await page.waitForSelector("#catalog-create-title")
    await clickButton("Continue")
    await page.waitForSelector('[role="alert"]')
  }
  if (clickText) {
    await clickButton(clickText)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  await page.screenshot({ fullPage: true, path: screenshotPath })

  const layout = await page.evaluate(() => ({
    bodyText: (document.body.textContent ?? "").trim().slice(0, 600),
    clientWidth: document.documentElement.clientWidth,
    headings: Array.from(document.querySelectorAll("h1,h2,h3"), (heading) =>
      (heading.textContent ?? "").trim()
    ).filter(Boolean),
    path: location.pathname,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  const hasMain = (await page.$("main")) !== null
  const axe = hasMain
    ? await new AxePuppeteer(page).include(axeInclude).analyze()
    : { incomplete: [], violations: [] }
  const accessibility = await page.evaluate((selector) => {
    const root = document.querySelector(selector) ?? document.body
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.clip === "auto" &&
        style.clipPath === "none" &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const name = (element) => {
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
      const associatedLabels =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Array.from(element.labels ?? [], (label) => label.textContent ?? "")
              .join(" ")
              .trim()
          : ""
      return (
        [
          element.getAttribute("aria-label"),
          labelledBy,
          associatedLabels,
          element.getAttribute("title"),
          element.textContent,
        ].find((value) => value?.trim()) ?? ""
      )
        .trim()
        .replace(/\s+/gu, " ")
        .slice(0, 120)
    }
    const targetSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type=hidden])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(",")
    const controlSelector = [
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(",")
    const controls = Array.from(root.querySelectorAll(controlSelector)).filter(
      visible
    )
    const danglingAriaControls = Array.from(
      root.querySelectorAll("[aria-controls]")
    )
      .filter(visible)
      .flatMap((element) =>
        (element.getAttribute("aria-controls") ?? "")
          .split(/\s+/u)
          .filter((id) => id && !document.getElementById(id))
          .map((id) => ({
            controlledId: id,
            html: element.outerHTML.slice(0, 500),
            name: name(element),
          }))
      )
    const unnamedControls = controls
      .filter((element) => {
        if (name(element)) {
          return false
        }
        if (
          (element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement) &&
          element.labels?.length
        ) {
          return false
        }
        return !element.getAttribute("aria-labelledby")
      })
      .map((element) => element.outerHTML.slice(0, 200))
    const undersizedTargets = Array.from(root.querySelectorAll(targetSelector))
      .filter(visible)
      .map((element) => {
        const wrappedLabel =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.closest("label")
            : null
        const target = wrappedLabel ?? element
        const rect = target.getBoundingClientRect()
        return {
          height: Math.round(rect.height * 10) / 10,
          name: name(element),
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width * 10) / 10,
        }
      })
      .filter(({ height, width }) => height < 24 || width < 24)
    const positiveTabIndexes = Array.from(root.querySelectorAll("[tabindex]"))
      .filter((element) => element.tabIndex > 0)
      .map((element) => ({ name: name(element), tabIndex: element.tabIndex }))
    const longRunningAnimations = root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running")
      .map((animation) => animation.effect?.getTiming())
      .filter(
        (timing) =>
          timing &&
          (timing.iterations === Number.POSITIVE_INFINITY ||
            (typeof timing.duration === "number" && timing.duration > 500))
      ).length
    return {
      danglingAriaControls,
      headingCount: root.querySelectorAll("h1,h2,h3").length,
      liveRegionCount: root.querySelectorAll(
        '[aria-live], [role="alert"], [role="status"]'
      ).length,
      longRunningAnimations,
      positiveTabIndexes,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      undersizedTargets,
      unnamedControls,
    }
  }, axeInclude)

  const focusOrder = []
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab")
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    const focused = await page.evaluate((selector) => {
      const element = document.activeElement
      const root = document.querySelector(selector) ?? document.body
      if (!(element instanceof HTMLElement) || !root.contains(element)) {
        return null
      }
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const centerX = Math.min(
        Math.max(rect.left + rect.width / 2, 0),
        innerWidth - 1
      )
      const centerY = Math.min(
        Math.max(rect.top + rect.height / 2, 0),
        innerHeight - 1
      )
      const topmost = document.elementFromPoint(centerX, centerY)
      const coveredBy =
        topmost && !element.contains(topmost) && !topmost.contains(element)
          ? {
              className:
                topmost instanceof HTMLElement ? topmost.className : "",
              tag: topmost.tagName.toLowerCase(),
              text: (topmost.textContent ?? "")
                .trim()
                .replace(/\s+/gu, " ")
                .slice(0, 80),
            }
          : null
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
      const associatedLabels =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Array.from(element.labels ?? [], (label) => label.textContent ?? "")
              .join(" ")
              .trim()
          : ""
      return {
        coveredBy,
        focusVisible:
          style.outlineStyle !== "none" || style.boxShadow !== "none",
        name: (
          [
            element.getAttribute("aria-label"),
            labelledBy,
            associatedLabels,
            element.getAttribute("title"),
            element.textContent,
          ].find((value) => value?.trim()) ?? ""
        )
          .trim()
          .replace(/\s+/gu, " ")
          .slice(0, 120),
        obscured:
          rect.bottom <= 0 ||
          rect.right <= 0 ||
          rect.top >= innerHeight ||
          rect.left >= innerWidth ||
          !topmost ||
          (!element.contains(topmost) && !topmost.contains(element)),
        tag: element.tagName.toLowerCase(),
      }
    }, axeInclude)
    if (focused) {
      focusOrder.push(focused)
    }
  }

  const findingCodes = [
    ...(!hasMain ? ["main_landmark_missing"] : []),
    ...(layout.path !== route ? ["route_mismatch"] : []),
    ...(layout.scrollWidth - layout.clientWidth > 1
      ? ["horizontal_overflow"]
      : []),
    ...(layout.headings.length === 0 ? ["heading_missing"] : []),
    ...(axe.violations.length > 0 ? ["axe_violation"] : []),
    ...(axe.incomplete.length > 0 ? ["axe_incomplete"] : []),
    ...(accessibility.danglingAriaControls.length > 0
      ? ["dangling_aria_controls"]
      : []),
    ...(accessibility.unnamedControls.length > 0 ? ["unnamed_control"] : []),
    ...(accessibility.undersizedTargets.length > 0
      ? ["undersized_target"]
      : []),
    ...(accessibility.positiveTabIndexes.length > 0
      ? ["positive_tabindex"]
      : []),
    ...(accessibility.longRunningAnimations > 0
      ? ["reduced_motion_animation"]
      : []),
    ...(!accessibility.reducedMotion ? ["reduced_motion_not_emulated"] : []),
    ...(focusOrder.length === 0 ? ["keyboard_focus_missing"] : []),
    ...(focusOrder.some(({ focusVisible }) => !focusVisible)
      ? ["focus_not_visible"]
      : []),
    ...(focusOrder.some(({ obscured }) => obscured) ? ["focus_obscured"] : []),
    ...(failedResponses.length > 0 ? ["failed_response"] : []),
    ...(issues.length > 0 ? ["browser_issue"] : []),
  ]
  const uniqueFindingCodes = [...new Set(findingCodes)]
  const reviewCodes = axe.incomplete.map(({ id }) => `axe_incomplete:${id}`)
  console.log(
    JSON.stringify(
      {
        axe: {
          incomplete: axe.incomplete.map(({ help, id, impact, nodes }) => ({
            help,
            id,
            impact,
            nodes: nodes.map(({ failureSummary, html, target }) => ({
              failureSummary,
              html,
              target,
            })),
          })),
          violations: axe.violations.map(({ help, id, impact, nodes }) => ({
            help,
            id,
            impact,
            nodes: nodes.map(({ failureSummary, html, target }) => ({
              failureSummary,
              html,
              target,
            })),
          })),
        },
        accessibility,
        failedResponses,
        focusOrder,
        fixtureRequests: Object.fromEntries(fixtureRequests),
        findingCodes: uniqueFindingCodes,
        issues: issues.slice(0, 20),
        layout,
        reviewCodes,
        screenshotPath,
        status: uniqueFindingCodes.length === 0 ? "passed" : "failed",
      },
      null,
      2
    )
  )
  if (holdMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, holdMs))
  }
  if (uniqueFindingCodes.length > 0) {
    throw new Error(
      `Admin visual acceptance failed: ${uniqueFindingCodes.join(", ")}`
    )
  }
} finally {
  await browser?.close()
  await staticServer?.close()
}
