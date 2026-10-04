import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, isAbsolute } from "node:path"

import {
  rejectAdminAcceptanceMutation,
  startAdminStaticServer,
} from "./admin-static-server.mjs"

const require = createRequire(new URL("../package.json", import.meta.url))
const puppeteer = require("puppeteer")
const { AxePuppeteer } = require("@axe-core/puppeteer")
const {
  parseTaxReportPeriod,
} = require("./backend/.medusa/server/src/lib/tax-reporting/periods.js")

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
const taxConfiguration =
  process.env.ADMIN_ACCEPTANCE_TAX_CONFIGURATION ?? "ready"
const taxRecordsState =
  process.env.ADMIN_ACCEPTANCE_TAX_RECORDS_STATE ?? "ready"
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
if (!["ready", "unconfigured"].includes(taxConfiguration)) {
  await staticServer?.close()
  throw new TypeError(
    "ADMIN_ACCEPTANCE_TAX_CONFIGURATION must be ready or unconfigured."
  )
}
if (!["ready", "unavailable"].includes(taxRecordsState)) {
  await staticServer?.close()
  throw new TypeError("Admin tax-records fixture state is invalid.")
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
const pendingTaxRecord = {
  collectionMode: "disabled",
  currencyCode: "usd",
  destination: {
    city: "Hartford",
    countryCode: "US",
    county: null,
    jurisdictionLevel: null,
    jurisdictionName: null,
    postalCode: "06103",
    stateCode: "CT",
  },
  displayId: 9,
  generation: 2,
  grossSales: "9.07",
  id: "tax_record_acceptance",
  issues: [
    "Tax was not collected for this order; confirm the operating decision and filing treatment.",
  ],
  nontaxableSales: "0.00",
  occurredAt: "2026-10-04T14:36:00.000Z",
  orderId: "order_acceptance",
  provider: "not_applicable",
  quality: "review",
  refundId: null,
  refundCreditTiming: null,
  refundTaxMethod: null,
  taxAmount: "0.00",
  taxableSales: "0.00",
  taxCalculationId: null,
  taxRatePercent: null,
  total: "9.07",
  type: "sale",
  unclassifiedSales: "9.07",
}
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

// A pre-existing native draft exercises RMA rendering without an initialization
// mutation. The acceptance server continues to reject every write request.
const rmaItem = {
  id: "ordli_acceptance",
  created_at: timestamp,
  title: "M",
  product_title: "Acceptance Shirt",
  product_id: "product_acceptance",
  variant_id: "variant_acceptance",
  variant_title: "M",
  variant_sku: "ACCEPTANCE-M",
  thumbnail: null,
  quantity: 1,
  unit_price: 2.34,
  subtotal: 2.34,
  total: 2.34,
  original_total: 2.34,
  refundable_total: 2.34,
  tax_total: 0,
  discount_total: 0,
  adjustments: [],
  tax_lines: [],
  requires_shipping: true,
  variant: {
    id: "variant_acceptance",
    title: "M",
    manage_inventory: false,
    product: { id: "product_acceptance", title: "Acceptance Shirt" },
  },
  detail: {
    quantity: 1,
    fulfilled_quantity: 1,
    shipped_quantity: 1,
    delivered_quantity: 1,
    return_requested_quantity: 0,
    return_received_quantity: 0,
    return_dismissed_quantity: 0,
  },
}
const rmaChange = {
  id: "ordch_acceptance",
  order_id: "order_acceptance",
  change_type: "exchange",
  status: "pending",
  exchange_id: "oexc_acceptance",
  return_id: "return_acceptance",
  actions: [],
}
const rmaOrder = {
  id: "order_acceptance",
  display_id: 9,
  created_at: timestamp,
  updated_at: timestamp,
  status: "pending",
  payment_status: "captured",
  fulfillment_status: "delivered",
  currency_code: "usd",
  email: "acceptance@example.invalid",
  customer_id: null,
  customer: null,
  metadata: {},
  version: 1,
  region: { id: "region_acceptance", name: "United States" },
  sales_channel: { id: "sc_acceptance", name: "Acceptance" },
  items: [rmaItem],
  shipping_methods: [],
  payment_collections: [],
  fulfillments: [],
  returns: [],
  claims: [],
  exchanges: [],
  transactions: [],
  promotions: [],
  order_change: null,
  summary: {
    paid_total: 2.34,
    refunded_total: 0,
    accounting_total: 2.34,
    original_order_total: 2.34,
    current_order_total: 2.34,
    transaction_total: 2.34,
    pending_difference: 0,
  },
  total: 2.34,
  subtotal: 2.34,
  item_total: 2.34,
  item_subtotal: 2.34,
  item_tax_total: 0,
  item_discount_total: 0,
  shipping_total: 0,
  shipping_subtotal: 0,
  shipping_tax_total: 0,
  shipping_discount_total: 0,
  tax_total: 0,
  discount_total: 0,
  credit_line_total: 0,
  credit_lines: [],
}
const rmaPreview = {
  ...rmaOrder,
  order_change: rmaChange,
  items: [
    {
      ...rmaItem,
      return_requested_total: 2.34,
      detail: { ...rmaItem.detail, return_requested_quantity: 1 },
      actions: [
        {
          id: "ordchact_acceptance",
          action: "RETURN_ITEM",
          exchange_id: "oexc_acceptance",
          return_id: "return_acceptance",
          internal_note: "",
          details: { reason_id: "", quantity: 1 },
        },
      ],
    },
  ],
}

const listKeyByPath = new Map([
  ["/admin/api-keys", "api_keys"],
  ["/admin/campaigns", "campaigns"],
  ["/admin/collections", "collections"],
  ["/admin/customer-groups", "customer_groups"],
  ["/admin/refund-reasons", "refund_reasons"],
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
  if (pathname === "/admin/orders/order_acceptance") {
    return { order: rmaOrder }
  }
  if (pathname === "/admin/orders/order_acceptance/preview") {
    return { order: rmaPreview }
  }
  if (pathname === "/admin/exchanges/oexc_acceptance") {
    return {
      exchange: {
        id: "oexc_acceptance",
        order_id: "order_acceptance",
        return_id: "return_acceptance",
        display_id: 1,
        created_at: timestamp,
        additional_items: [],
        return_items: [],
        shipping_methods: [],
        canceled_at: null,
      },
    }
  }
  if (pathname === "/admin/returns/return_acceptance") {
    return {
      return: {
        id: "return_acceptance",
        order_id: "order_acceptance",
        status: "requested",
        location_id: null,
        items: [],
        shipping_methods: [],
      },
    }
  }
  if (pathname === "/admin/plugins") return { plugins: [] }
  if (pathname === "/admin/reservations") return paged("reservations")
  if (pathname === "/admin/returns") return paged("returns")
  if (pathname === "/admin/stock-locations") {
    return paged("stock_locations", [
      { id: "sloc_acceptance", name: "Acceptance HQ" },
    ])
  }
  if (pathname === "/admin/shipping-options") return paged("shipping_options")
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
        descriptionHtml: "Fixture release description with plain text.",
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
    if (taxRecordsState === "unavailable") return { invalid: "fixture" }
    return {
      destinations: [],
      filingState: url.searchParams.get("filing_state") ?? "CT",
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
      period: parseTaxReportPeriod({
        startDate: url.searchParams.get("start") ?? "2026-07-01",
        endDate: url.searchParams.get("end") ?? "2026-10-01",
      }),
      records: setup === "tax-record-classification" ? [pendingTaxRecord] : [],
      resultCount: setup === "tax-record-classification" ? 1 : 0,
      source: {
        medusaOrdersScanned: setup === "tax-record-classification" ? 1 : 0,
        scopedRecords: setup === "tax-record-classification" ? 1 : 0,
        truncated: false,
        unassignedStateRecords: 0,
      },
      summaries: [
        {
          completeRecords: 0,
          currencyCode: "usd",
          disabledRecordCount: setup === "tax-record-classification" ? 1 : 0,
          grossSales: setup === "tax-record-classification" ? "9.07" : "0.00",
          incompleteRecords: 0,
          netSales: setup === "tax-record-classification" ? "9.07" : "0.00",
          netTax: "0.00",
          nontaxableSales: "0.00",
          orderCount: setup === "tax-record-classification" ? 1 : 0,
          priorPeriodRefundCount: 0,
          refundCount: 0,
          refundedSales: "0.00",
          refundedTax: "0.00",
          reviewRecords: setup === "tax-record-classification" ? 1 : 0,
          samePeriodRefundCount: 0,
          taxCollected: "0.00",
          taxableSales: "0.00",
          unclassifiedSales:
            setup === "tax-record-classification" ? "9.07" : "0.00",
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
    const unconfiguredTaxRateIo = {
      checks: [
        {
          detail: "Set TAX_RATE_LOOKUP_API_KEY.",
          id: "api_key",
          label: "API key",
          ready: false,
        },
      ],
      configured: false,
      message: "TaxRate.io is not configured.",
      ready: false,
    }
    const unconfiguredStripeTax = {
      accountMode: "unknown",
      activeRegistrationCount: 0,
      checks: [
        {
          detail: "Set STRIPE_API_KEY for this environment.",
          id: "api_key",
          label: "Stripe key",
          ready: false,
        },
      ],
      configured: false,
      message: "Stripe is not configured.",
      missingFields: [],
      ready: false,
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
          ...(taxConfiguration === "unconfigured"
            ? unconfiguredStripeTax
            : {
                ...ready,
                accountMode: "sandbox",
                activeRegistrationCount: 1,
                missingFields: [],
              }),
        },
        taxRateIo: {
          ...(taxConfiguration === "unconfigured"
            ? unconfiguredTaxRateIo
            : ready),
          manualRefreshConfigured: true,
          quota:
            taxConfiguration === "unconfigured"
              ? null
              : {
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
const navigations = []
const issues = []
const failedResponses = []
const fixtureRequests = new Map()

try {
  browser = await puppeteer.launch({
    args: [
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
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(new URL(frame.url()).pathname)
    }
  })
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
    if (rejectAdminAcceptanceMutation(request, (code) => issues.push(code))) {
      return
    }
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
  // Wait for the compiled route and fixture requests, not just the shell.
  // A fixed sleep alone can audit skeletons while lazy routes still load.
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main")
      return (
        main?.querySelector("h1,h2,h3") &&
        !main.querySelector('[aria-busy="true"], .animate-pulse')
      )
    },
    { timeout: 30_000 }
  )
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
  if (route === "/app/catalog/products/product_acceptance") {
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[contenteditable="true"]')).some(
        (editor) =>
          editor.textContent?.includes(
            "Fixture release description with plain text."
          )
      )
    )
  }
  if (setup === "native-refund-reason-validation") {
    await page.waitForSelector('[role="dialog"] input[name="label"]')
    await clickButton("Save")
    await page.waitForFunction(() => {
      const label = document.querySelector('input[name="label"]')
      const code = document.querySelector('input[name="code"]')
      return (
        label?.getAttribute("aria-invalid") === "true" &&
        code?.getAttribute("aria-invalid") === "true" &&
        document.activeElement === label
      )
    })
  }
  if (setup === "native-exchange-hints" || setup === "native-exchange-picker") {
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]')
      return (
        dialog?.textContent.includes("Create Exchange") &&
        dialog.textContent.includes("Acceptance Shirt") &&
        dialog.querySelector('input[name="inbound_items.0.note"]')
      )
    })
    const invalidIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[id], [aria-labelledby]"))
        .filter((element) =>
          `${element.id} ${element.getAttribute("aria-labelledby")}`.includes(
            "undefined-form-item"
          )
        )
        .map((element) => element.outerHTML)
    )
    if (invalidIds.length)
      throw new Error("Standalone hints generated invalid IDs")
    await page.click('input[name="inbound_items.0.reason_id"]')
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="listbox"]')).some(
        (popup) => getComputedStyle(popup).display !== "none"
      )
    )
    const openSelectorLinked = await page.evaluate(() => {
      const field = document.querySelector(
        'input[name="inbound_items.0.reason_id"]'
      )
      const popupId = field.getAttribute("aria-controls")
      return (
        field.getAttribute("aria-expanded") === "true" &&
        Boolean(popupId && document.getElementById(popupId))
      )
    })
    if (!openSelectorLinked)
      throw new Error("Open selector has no exact popup reference")
    await page.keyboard.press("Escape")
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="listbox"]')).every(
        (popup) => getComputedStyle(popup).display === "none"
      )
    )
    if (!page.url().endsWith("/app/orders/order_acceptance/exchanges")) {
      throw new Error("Closing a selector dismissed its parent exchange form")
    }
    if (
      await page.$eval('input[name="inbound_items.0.reason_id"]', (field) =>
        field.hasAttribute("aria-controls")
      )
    ) {
      throw new Error("Closed selector retains an unavailable popup reference")
    }
    if (setup === "native-exchange-picker") {
      await clickButton("Add items")
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (dialog) =>
            dialog.getAttribute("aria-hidden") !== "true" &&
            dialog.textContent.includes("Add items — Inbound") &&
            dialog.querySelector('[role="checkbox"][aria-label="Select all"]')
        )
      )
    }
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
    await page.waitForFunction(
      () => document.activeElement?.id === "catalog-create-title"
    )
    await page.type("#catalog-create-title", "Acceptance Release")
    await clickButton("Continue")
    await page.waitForFunction(
      () => document.activeElement?.id === "catalog-create-artist"
    )
  }
  if (setup === "tax-record-classification") {
    const classified = await page.evaluate((mobile) => {
      if (mobile) {
        const card = document.querySelector("main article")
        return (
          card?.textContent.includes("Pending tax review") &&
          card.textContent.includes("$9.07")
        )
      }
      const table = document.querySelector(
        '[aria-label="Tax record table; scroll horizontally for all columns"] table'
      )
      return (
        table?.textContent.includes("Sales classification") &&
        table.textContent.includes("Pending tax review") &&
        table.textContent.includes("$9.07") &&
        !table.textContent.includes("Taxable")
      )
    }, width < 768)
    if (!classified) throw new Error("Pending sales were mislabeled as taxable")
    await page.evaluate((mobile) => {
      const record = document.querySelector(
        mobile
          ? "main article"
          : '[aria-label="Tax record table; scroll horizontally for all columns"]'
      )
      record?.scrollIntoView({ block: "center" })
    }, width < 768)
  }
  if (setup === "tax-period-validation") {
    const taxRequests = []
    const collect = (request) => {
      if (new URL(request.url()).pathname === "/admin/tax-records") {
        taxRequests.push(request.url())
      }
    }
    page.on("request", collect)
    const setDate = (selector, value) =>
      page.$eval(
        selector,
        (element, date) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          ).set
          setter.call(element, date)
          element.dispatchEvent(new Event("input", { bubbles: true }))
          element.dispatchEvent(new Event("change", { bubbles: true }))
        },
        value
      )
    const expectInvalid = async (start, end, message, focus) => {
      await setDate("#tax-period-start", start)
      await setDate("#tax-period-end", end)
      await clickButton("Apply period")
      await page.waitForFunction(
        (expected, field) => {
          const alert = document.querySelector("#tax-period-error")
          return (
            alert?.textContent === expected &&
            document.activeElement?.id === field
          )
        },
        {},
        message,
        focus
      )
      if (taxRequests.length)
        throw new Error("Invalid period reached the report API")
    }
    await expectInvalid(
      "2027-02-01",
      "2027-01-01",
      "The report end date must be after its start date.",
      "tax-period-end"
    )
    await expectInvalid(
      "2027-01-01",
      "2027-01-01",
      "The report end date must be after its start date.",
      "tax-period-end"
    )
    await expectInvalid(
      "",
      "2027-01-01",
      "Enter a valid start date and end date.",
      "tax-period-start"
    )
    await expectInvalid(
      "2020-01-01",
      "2027-01-01",
      "Tax reports are limited to 1462 days at a time.",
      "tax-period-end"
    )
    await setDate("#tax-period-start", "2026-09-01")
    await setDate("#tax-period-end", "2026-10-01")
    await clickButton("Apply period")
    await page.waitForFunction(() =>
      document
        .querySelector("main")
        ?.textContent.includes("Sep 1, 2026 – Sep 30, 2026")
    )
    if (
      taxRequests.length !== 1 ||
      !taxRequests[0].includes("start=2026-09-01") ||
      !taxRequests[0].includes("end=2026-10-01")
    ) {
      throw new Error("Corrected period did not request the exact new report")
    }
    // Leave the last applied workpaper visible beside an actionable validation
    // error for screenshot and accessibility inspection.
    taxRequests.length = 0
    await expectInvalid(
      "2026-11-01",
      "2026-10-01",
      "The report end date must be after its start date.",
      "tax-period-end"
    )
    page.off("request", collect)
    // Focus recovery is asserted above. Restore the scroll containers before
    // contrast analysis so the sticky shell cannot overlap off-screen copy.
    await page.evaluate(() => {
      const main = document.querySelector("main")
      for (const container of [main, ...main.querySelectorAll("*")]) {
        if (container.scrollHeight > container.clientHeight)
          container.scrollTo({ top: 0, behavior: "instant" })
      }
      let ancestor = main.parentElement
      while (ancestor) {
        ancestor.scrollTo({ top: 0, behavior: "instant" })
        ancestor = ancestor.parentElement
      }
      window.scrollTo({ top: 0, behavior: "instant" })
    })
  }
  if (setup === "tax-provider-availability") {
    await page.evaluate(() => {
      document
        .querySelector('section[aria-label^="TaxRate.io"]')
        ?.scrollIntoView({ block: "center" })
    })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  if (clickText) {
    await clickButton(clickText)
    await page.waitForSelector(axeInclude, { visible: true })
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
        !element.closest('[aria-hidden="true"]') &&
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
} catch (error) {
  console.error(
    JSON.stringify({
      navigations: navigations.slice(0, 20),
      issues: issues.slice(0, 20),
      failedResponses: failedResponses.slice(0, 20),
      fixtureRequests: Object.fromEntries(fixtureRequests),
    })
  )
  throw error
} finally {
  await browser?.close()
  await staticServer?.close()
}
