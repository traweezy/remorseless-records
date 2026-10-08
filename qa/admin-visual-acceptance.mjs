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
const nativeProductStates = []
let nativeClipboardProof = null
let nativeDrawerProof = null
let nativeInitialKeyboardProof = null
let nativeSettingsProof = null
let nativeFunctionalTextContrast = null
let nativeProductTypeProof = null
const blockedMutationRequests = []
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

const isNativeProductTypeCase = setup === "native-product-type-cancel-focus"
const isNativeProductCase = setup.startsWith("native-product-controls-")
const isNativeSettingsCase = setup.startsWith("native-settings-")
const nativeSettingsRegion = {
  id: "reg_acceptance",
  name: "US",
  currency_code: "usd",
  automatic_taxes: true,
  metadata: {},
  created_at: timestamp,
  updated_at: timestamp,
  countries: [
    {
      iso_2: "us",
      iso_3: "usa",
      num_code: 840,
      name: "UNITED STATES",
      display_name: "United States",
      region_id: "reg_acceptance",
    },
    {
      iso_2: "ca",
      iso_3: "can",
      num_code: 124,
      name: "CANADA",
      display_name: "Canada",
      region_id: "reg_acceptance",
    },
  ],
  payment_providers: [
    { id: "pp_system_default", is_enabled: true },
    { id: "pp_stripe_stripe", is_enabled: true },
  ],
}
const nativeSettingsCurrencies = [
  {
    code: "usd",
    name: "US Dollar",
    symbol: "$",
    symbol_native: "$",
    decimal_digits: 2,
    rounding: 0,
  },
  {
    code: "eur",
    name: "Euro",
    symbol: "€",
    symbol_native: "€",
    decimal_digits: 2,
    rounding: 0,
  },
]
const nativeSettingsRoleUsers = [
  ["Alexandria", "Fixture Operator"],
  ["Christopher", "Fixture Reviewer"],
  ["Morgan", "Fixture Observer"],
].map(([first_name, last_name], index) => ({
  id: `user_role_fixture_${index}`,
  first_name,
  last_name,
  email: `role-fixture-${index}@example.invalid`,
  created_at: timestamp,
  updated_at: timestamp,
}))
const nativeSettingsRole = {
  id: "role_acceptance",
  name: "Audit operator",
  description: "Owned read-only fixture",
  created_at: timestamp,
  updated_at: timestamp,
  users_link: nativeSettingsRoleUsers.map((user) => ({ user })),
  policies: [
    { id: "policy_fixture_product", key: "product:read" },
    { id: "policy_fixture_order", key: "order:read" },
    { id: "policy_fixture_user", resource: "user", operation: "read" },
  ],
  metadata: {},
}
const nativeProduct = {
  ...product,
  options: [{ id: "option_acceptance", title: "Format", values: [] }],
  variants: [
    ...product.variants.map((variant) => ({
      ...variant,
      allow_backorder: false,
      created_at: timestamp,
      inventory_items: [],
      options: [
        {
          id: "value_vinyl",
          option_id: "option_acceptance",
          value: "Black Vinyl",
        },
      ],
      product_id: product.id,
      thumbnail: null,
      variant_rank: 0,
    })),
    {
      id: "variant_acceptance_cd",
      product_id: product.id,
      title: "CD",
      sku: "RR-001-CD",
      manage_inventory: false,
      allow_backorder: false,
      inventory_quantity: 0,
      inventory_items: [],
      created_at: timestamp,
      options: [
        { id: "value_cd", option_id: "option_acceptance", value: "CD" },
      ],
      prices: [],
      thumbnail: null,
      variant_rank: 1,
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
  title: "Acceptance Shirt",
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
  original_total: 2.34,
  original_subtotal: 2.34,
  original_tax_total: 0,
  original_shipping_total: 0,
  original_shipping_subtotal: 0,
  original_shipping_tax_total: 0,
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
  return_requested_total: 2.34,
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

const inventoryCase =
  /^native-(claim|return)-inventory-(ready|missing|pending|unavailable)$/u.exec(
    setup
  )
const selectedInventoryRead = (url) =>
  [...url.searchParams.keys()].some((key) => /^id(?:\[.*\])?$/u.test(key))
const isSummaryCase = setup === "native-order-summary-long-sku"
const isPartialReturnCase = setup === "native-order-partial-return"
const inventoryItem = {
  ...rmaItem,
  variant: { ...rmaItem.variant, manage_inventory: true },
}
const inventoryChange = inventoryCase && {
  ...rmaChange,
  change_type: inventoryCase[1] === "claim" ? "claim" : "return_request",
  claim_id: inventoryCase[1] === "claim" ? "claim_acceptance" : null,
  exchange_id: null,
}
const summaryItem = {
  ...rmaItem,
  title: "Acceptance Release With A Long Product Title",
  product_title: "Acceptance Release With A Long Product Title",
  variant_title: "CD / Limited Edition",
  variant_sku:
    "MUSIC_RELEASE_RR_AUDIT_B8517C2C_LONG_RELEASE_IDENTIFICATION_CD_LIMITED_EDITION",
  variant: { ...rmaItem.variant, options: [{ value: "CD / Limited Edition" }] },
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
  if (isNativeSettingsCase) {
    if (pathname === "/admin/regions/reg_acceptance")
      return { region: nativeSettingsRegion }
    if (pathname === "/admin/regions")
      return paged("regions", [nativeSettingsRegion])
    if (pathname === "/admin/price-preferences")
      return paged("price_preferences")
    if (pathname === "/admin/currencies")
      return paged("currencies", nativeSettingsCurrencies)
    if (pathname === "/admin/payments/payment-providers")
      return paged("payment_providers", nativeSettingsRegion.payment_providers)
    if (pathname === "/admin/refund-reasons")
      return paged("refund_reasons", [
        {
          id: "ref_reason_acceptance",
          label: "Damaged item",
          description: "An item arrived damaged",
          created_at: timestamp,
          updated_at: timestamp,
        },
      ])
    if (pathname === "/admin/rbac/me/permissions")
      return {
        permissions: [
          "rbac_role:read",
          "rbac_role:create",
          ...(setup.includes("role-detail")
            ? ["user:read", "rbac_policy:read"]
            : []),
        ],
      }
    if (pathname === "/admin/rbac/roles/role_acceptance")
      return { role: nativeSettingsRole }
    if (pathname === "/admin/rbac/roles/role_acceptance/users")
      return paged("users", nativeSettingsRoleUsers)
    if (pathname === "/admin/rbac/roles")
      return paged("roles", [nativeSettingsRole])
    const columns = pathname.match(
      /^\/admin\/views\/(regions|refund-reasons)\/columns$/u
    )
    if (columns)
      return {
        columns: [
          {
            id: columns[1] === "regions" ? "name" : "label",
            field: columns[1] === "regions" ? "name" : "label",
            name: "Name",
            render_mode: "text",
            data_type: "string",
            default_visible: true,
            default_order: 0,
            sortable: true,
            hideable: true,
            filter: { enabled: false },
            metadata: {},
          },
          {
            id: "created_at",
            field: "created_at",
            name: "Created",
            render_mode: "datetime",
            data_type: "date",
            default_visible: true,
            default_order: 1,
            sortable: true,
            hideable: true,
            filter: { enabled: false },
            metadata: {},
          },
        ],
      }
  }
  if (pathname === "/admin/orders" && setup.startsWith("native-order-list-")) {
    return paged("orders", [{ ...rmaOrder, display_id: 10 }])
  }
  if (pathname === "/admin/views/orders/columns") {
    return {
      columns: [
        {
          id: "display_id",
          field: "display_id",
          name: "Order",
          render_mode: "display_id",
          data_type: "number",
          default_visible: true,
          default_order: 0,
          sortable: false,
          hideable: false,
          filter: { enabled: false },
          metadata: {},
        },
        {
          id: "created_at",
          field: "created_at",
          name: "Date",
          render_mode: "datetime",
          data_type: "date",
          default_visible: true,
          default_order: 1,
          sortable: false,
          hideable: false,
          filter: { enabled: false },
          metadata: {},
        },
        {
          id: "payment_status",
          field: "payment_status",
          name: "Payment",
          render_mode: "string",
          data_type: "string",
          default_visible: true,
          default_order: 2,
          sortable: false,
          hideable: false,
          filter: { enabled: false },
          metadata: {},
        },
      ],
    }
  }
  if (pathname === "/admin/views/orders/configurations")
    return paged("view_configurations")
  if (pathname === "/admin/views/orders/configurations/active")
    return { view_configuration: null, is_default_active: true }
  if (pathname === "/admin/orders/order_acceptance") {
    if (inventoryCase) return { order: { ...rmaOrder, items: [inventoryItem] } }
    if (isSummaryCase) return { order: { ...rmaOrder, items: [summaryItem] } }
    if (setup === "native-refund-controls") {
      return {
        order: {
          ...rmaOrder,
          payment_collections: [
            {
              id: "paycol_acceptance",
              payments: [
                {
                  id: "pay_acceptance",
                  amount: 2.34,
                  currency_code: "usd",
                  provider_id: "pp_stripe_stripe",
                  created_at: timestamp,
                  updated_at: timestamp,
                  canceled_at: null,
                  captured_at: timestamp,
                  captures: [
                    {
                      id: "cap_acceptance",
                      amount: 2.34,
                      created_at: timestamp,
                    },
                  ],
                  refunds: [],
                },
              ],
            },
          ],
        },
      }
    }
    if (setup === "native-allocation" || setup === "native-allocation-kit") {
      return {
        order: {
          ...rmaOrder,
          fulfillment_status: "not_fulfilled",
          items: [
            {
              ...rmaItem,
              detail: {
                ...rmaItem.detail,
                fulfilled_quantity: 0,
                shipped_quantity: 0,
                delivered_quantity: 0,
              },
              variant: {
                ...rmaItem.variant,
                manage_inventory: true,
                inventory: [
                  {
                    id: "iitem_acceptance",
                    title: "Acceptance Shirt M",
                    location_levels: [
                      {
                        location_id: "sloc_acceptance",
                        available_quantity: 3,
                        stocked_quantity: 3,
                        reserved_quantity: 0,
                      },
                    ],
                  },
                ],
                inventory_items: [
                  {
                    inventory_item_id: "iitem_acceptance",
                    required_quantity:
                      setup === "native-allocation-kit" ? 2 : 1,
                  },
                ],
              },
            },
          ],
        },
      }
    }
    return { order: rmaOrder }
  }
  if (pathname === "/admin/orders/order_acceptance/preview") {
    if (isSummaryCase) return { order: { ...rmaOrder, items: [summaryItem] } }
    if (inventoryCase)
      return {
        order: {
          ...rmaPreview,
          order_change: inventoryChange,
          items: rmaPreview.items.map((item) => ({
            ...item,
            variant: inventoryItem.variant,
            actions: item.actions.map((action) => ({
              ...action,
              exchange_id: null,
              claim_id:
                inventoryCase[1] === "claim" ? "claim_acceptance" : null,
            })),
          })),
        },
      }
    if (setup === "native-return-receive") {
      return {
        order: {
          ...rmaOrder,
          order_change: { ...rmaChange, change_type: "return_receive" },
          items: [
            {
              ...rmaItem,
              actions: [
                {
                  id: "ordchact_receive",
                  action: "RECEIVE_RETURN_ITEM",
                  details: { quantity: 1 },
                },
              ],
            },
          ],
        },
      }
    }
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
  if (pathname === "/admin/claims/claim_acceptance")
    return {
      claim: {
        id: "claim_acceptance",
        order_id: "order_acceptance",
        return_id: "return_acceptance",
        type: "refund",
        display_id: 1,
        created_at: timestamp,
        claim_items: [],
        additional_items: [],
        shipping_methods: [],
        canceled_at: null,
      },
    }
  if (
    pathname === "/admin/product-variants" &&
    inventoryCase &&
    selectedInventoryRead(url)
  ) {
    const levels = (location_id) => [
      {
        location_id,
        stocked_quantity: 3,
        reserved_quantity: 0,
        available_quantity: 3,
      },
    ]
    const component = (id, location_id) => ({
      inventory_item_id: id,
      required_quantity: 1,
      inventory: { id, location_levels: levels(location_id) },
    })
    return {
      variants:
        inventoryCase[2] === "unavailable"
          ? []
          : [
              {
                id: "variant_acceptance",
                manage_inventory: true,
                inventory_items: [
                  component("iitem_first", "sloc_acceptance"),
                  component(
                    "iitem_second",
                    inventoryCase[2] === "missing"
                      ? "sloc_other"
                      : "sloc_acceptance"
                  ),
                ],
              },
            ],
      count: 1,
      offset: Number(url.searchParams.get("offset")),
      limit: Number(url.searchParams.get("limit")),
    }
  }
  if (pathname === "/admin/returns/return_acceptance") {
    return {
      return: {
        id: "return_acceptance",
        order_id: "order_acceptance",
        status: "requested",
        location_id:
          setup === "native-return-receive" || inventoryCase
            ? "sloc_acceptance"
            : null,
        items:
          setup === "native-return-receive"
            ? [{ item_id: rmaItem.id, quantity: 1 }]
            : [],
        shipping_methods: [],
      },
    }
  }
  if (pathname === "/admin/plugins") return { plugins: [] }
  if (pathname === "/admin/reservations") return paged("reservations")
  if (pathname === "/admin/returns") {
    const statuses = [...url.searchParams.entries()]
      .filter(([key]) => /^status(?:\[.*\])?$/u.test(key))
      .map(([, value]) => value)
    return paged(
      "returns",
      isPartialReturnCase && statuses.includes("partially_received")
        ? [
            {
              id: "return_acceptance",
              order_id: "order_acceptance",
              status: "partially_received",
              canceled_at: null,
              received_at: null,
              items: [
                { item_id: rmaItem.id, quantity: 2, received_quantity: 1 },
              ],
            },
          ]
        : []
    )
  }
  if (pathname === "/admin/stock-locations") {
    return paged("stock_locations", [
      { id: "sloc_acceptance", name: "Acceptance HQ" },
    ])
  }
  if (pathname === "/admin/stock-locations/sloc_acceptance") {
    return { stock_location: { id: "sloc_acceptance", name: "Acceptance HQ" } }
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
    return {
      feature_flags: {
        rbac:
          setup.startsWith("native-settings-roles") ||
          setup.includes("role-detail"),
        view_configurations:
          setup === "native-order-list-links" || isNativeSettingsCase,
      },
    }
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
          supported_currencies: isNativeSettingsCase
            ? nativeSettingsCurrencies.map((currency, index) => ({
                currency_code: currency.code,
                currency,
                is_default: index === 0,
              }))
            : [],
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
    isNativeProductCase &&
    pathname === "/admin/products/product_acceptance/variants"
  ) {
    let variants = nativeProduct.variants
    const managed = url.searchParams.get("manage_inventory")
    if (managed !== null)
      variants = variants.filter(
        (variant) => variant.manage_inventory === (managed === "true")
      )
    const order = url.searchParams.get("order")
    if (order === "title" || order === "-title")
      variants = [...variants].sort(
        (a, b) =>
          (order.startsWith("-") ? -1 : 1) * a.title.localeCompare(b.title)
      )
    return paged("variants", variants)
  }
  if (
    setup === "catalog-create-bundle-stock" &&
    pathname === "/admin/products/product_acceptance/variants"
  ) {
    const withStock = (url.searchParams.get("fields") ?? "").includes(
      "inventory_quantity"
    )
    return paged(
      "variants",
      product.variants.map((variant) => ({
        id: variant.id,
        manage_inventory: variant.manage_inventory,
        ...(withStock ? { inventory_quantity: 18 } : {}),
      }))
    )
  }
  if (
    pathname === "/admin/products" ||
    pathname === "/admin/products/product_acceptance"
  ) {
    return pathname === "/admin/products"
      ? paged("products", [
          setup === "catalog-create-bundle-stock"
            ? {
                ...product,
                variants: product.variants.map(
                  ({ inventory_quantity: _stock, ...variant }) => variant
                ),
              }
            : product,
        ])
      : { product: isNativeProductCase ? nativeProduct : product }
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
let page
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
  page = await browser.newPage()
  if (isSummaryCase && width === 390) {
    await browser
      .defaultBrowserContext()
      .overridePermissions(acceptanceOrigin, [
        "clipboard-read",
        "clipboard-write",
        "clipboard-sanitized-write",
      ])
  }
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
    ...(setup.startsWith("native-login-") ||
    isNativeProductCase ||
    isNativeSettingsCase
      ? [
          {
            name: "prefers-color-scheme",
            value: setup.endsWith("-dark") ? "dark" : "light",
          },
        ]
      : []),
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
    if (
      setup === "native-exchange-pending" &&
      message.type() === "warn" &&
      /Missing.*Description|requires.*DialogTitle/iu.test(message.text())
    ) {
      issues.push(`dialog:${message.text()}`)
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

  let pendingExchangeRequest
  let pendingInventoryRequest
  const inventoryRequests = []
  const pendingExchangeRead =
    setup === "native-exchange-pending"
      ? page.waitForRequest(
          (request) =>
            request.method() === "GET" &&
            new URL(request.url()).pathname ===
              "/admin/exchanges/oexc_acceptance",
          { timeout: 30_000 }
        )
      : null
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      blockedMutationRequests.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
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
      if (
        inventoryCase &&
        url.pathname === "/admin/product-variants" &&
        selectedInventoryRead(url)
      ) {
        inventoryRequests.push([...url.searchParams])
        if (inventoryCase[2] === "pending") {
          pendingInventoryRequest = request
          return
        }
      }
      if (
        setup === "native-exchange-pending" &&
        url.pathname === "/admin/exchanges/oexc_acceptance"
      ) {
        pendingExchangeRequest = request
        return
      }
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
  if (pendingExchangeRead) {
    await pendingExchangeRead
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const titleId = dialog?.getAttribute("aria-labelledby")
      const descriptionId = dialog?.getAttribute("aria-describedby")
      return (
        titleId &&
        document.getElementById(titleId)?.textContent === "Create Exchange" &&
        descriptionId &&
        document.getElementById(descriptionId)?.textContent?.trim() &&
        !dialog.querySelector('input[name="inbound_items.0.note"]')
      )
    })
    await page.screenshot({
      path: screenshotPath.replace(/\.png$/u, "-pending.png"),
      fullPage: true,
    })
    if (!pendingExchangeRequest)
      throw new Error("Pending native exchange read was not captured")
    await pendingExchangeRequest.respond({
      body: JSON.stringify(fixtureFor(new URL(pendingExchangeRequest.url()))),
      contentType: "application/json",
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": acceptanceOrigin,
        "cache-control": "no-store",
      },
      status: 200,
    })
    await page.waitForSelector('input[name="inbound_items.0.note"]')
  }
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
  if (isNativeProductTypeCase) {
    const createSelector = 'main a[href="/app/settings/product-types/create"]'
    const dialogSelector = '[role="dialog"][data-state="open"]'
    const cycles = []
    nativeProductTypeProof = {
      cycles,
      fieldsEntered: false,
      submitClicked: false,
      mutationFencesRetained: true,
    }
    await page.waitForSelector(createSelector, { visible: true })
    let tabReachedCreate = false
    for (let index = 0; index < 100; index++) {
      await page.keyboard.press("Tab")
      if (
        await page.$eval(
          createSelector,
          (node) => document.activeElement === node
        )
      ) {
        tabReachedCreate = true
        break
      }
    }
    if (!tabReachedCreate)
      throw new Error("Real Tab did not reach Product Type Create")
    nativeProductTypeProof.realTabReachedCreate = true
    const openNative = async () => {
      await page.keyboard.press("Enter")
      await page.waitForSelector(`${dialogSelector} input[name="value"]`, {
        visible: true,
      })
      await page.waitForFunction(
        (selector) => {
          const dialog = document.querySelector(selector)
          return (
            dialog &&
            getComputedStyle(dialog).opacity === "1" &&
            !dialog
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.playState === "running" || animation.pending
              )
          )
        },
        {},
        dialogSelector
      )
      const field = await page.$eval(
        `${dialogSelector} input[name="value"]`,
        (node) => {
          const dialog = node.closest('[role="dialog"]')
          return {
            value: node.value,
            labels: [...node.labels].map((label) => label.textContent.trim()),
            title: document
              .getElementById(dialog.getAttribute("aria-labelledby"))
              ?.textContent.trim(),
            focusInside: dialog.contains(document.activeElement),
            focusOnValue: document.activeElement === node,
          }
        }
      )
      if (
        field.value !== "" ||
        field.labels.join() !== "Value" ||
        field.title !== "Create Product Type" ||
        !field.focusInside ||
        !field.focusOnValue
      )
        throw new Error(
          "Native Product Type title, label or initial focus is invalid"
        )
      const controls = await page.$$eval(
        `${dialogSelector} input, ${dialogSelector} button`,
        (nodes) =>
          nodes
            .filter(
              (node) =>
                !node.disabled &&
                node.tabIndex >= 0 &&
                node.getClientRects().length
            )
            .map((node) => ({
              name: node.name || node.textContent.trim(),
              type: node.getAttribute("type"),
            }))
      )
      if (
        controls.length !== 3 ||
        controls[0].name !== "value" ||
        controls[1].name !== "Cancel" ||
        controls[2].type !== "submit"
      )
        throw new Error("Native Product Type focus-boundary controls changed")
      for (let index = 0; index < controls.length; index++) {
        await page.keyboard.press("Tab")
        await page.waitForFunction(
          (selector) =>
            document.activeElement?.closest(selector) &&
            !document.activeElement.closest('[aria-hidden="true"]'),
          {},
          dialogSelector
        )
      }
      await page.waitForFunction(
        (selector) =>
          document.activeElement ===
          document.querySelector(`${selector} input[name="value"]`),
        {},
        dialogSelector
      )
      await page.keyboard.down("Shift")
      try {
        await page.keyboard.press("Tab")
      } finally {
        await page.keyboard.up("Shift")
      }
      await page.waitForFunction(
        (selector) =>
          document.activeElement ===
          document.querySelector(`${selector} button[type="submit"]`),
        {},
        dialogSelector
      )
      field.boundary = { controls, forwardWrap: true, backwardWrap: true }
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        (selector) => {
          const input = document.querySelector(
            `${selector} input[name="value"]`
          )
          return (
            input?.getAttribute("aria-invalid") === "true" &&
            input.value === "" &&
            document.activeElement === input &&
            (input.getAttribute("aria-describedby") || "")
              .split(/\s+/u)
              .some((id) => {
                const message = document.getElementById(id)
                return (
                  message?.textContent.trim() && message.getClientRects().length
                )
              })
          )
        },
        {},
        dialogSelector
      )
      field.emptySubmit = await page.$eval(
        `${dialogSelector} input[name="value"]`,
        (input) => ({
          invalid: input.getAttribute("aria-invalid") === "true",
          value: input.value,
          focusOnValue: document.activeElement === input,
          errorId: input.getAttribute("aria-describedby"),
          error: document
            .getElementById(input.getAttribute("aria-describedby"))
            ?.textContent.trim(),
        })
      )
      if (!field.emptySubmit.error)
        throw new Error(
          "Native empty Product Type Enter did not produce validation"
        )
      // Return to the native Submit boundary for the independent dismissal cycle.
      await page.keyboard.down("Shift")
      try {
        await page.keyboard.press("Tab")
      } finally {
        await page.keyboard.up("Shift")
      }
      await page.waitForFunction(
        (selector) =>
          document.activeElement ===
          document.querySelector(`${selector} button[type="submit"]`),
        {},
        dialogSelector
      )
      return field
    }
    for (const dismissal of ["Cancel", "Escape"]) {
      const field = await openNative()
      await page.screenshot({
        fullPage: true,
        path: screenshotPath.replace(
          /\.png$/u,
          `-${dismissal.toLowerCase()}-open.png`
        ),
      })
      if (dismissal === "Cancel") {
        await page.keyboard.down("Shift")
        try {
          await page.keyboard.press("Tab")
        } finally {
          await page.keyboard.up("Shift")
        }
        await page.waitForFunction(
          () => document.activeElement?.textContent.trim() === "Cancel"
        )
        await page.keyboard.press("Enter")
      } else {
        await page.keyboard.press("Tab")
        await page.waitForFunction(
          (selector) =>
            document.activeElement ===
            document.querySelector(`${selector} input[name="value"]`),
          {},
          dialogSelector
        )
        await page.keyboard.press("Escape")
      }
      await page.waitForFunction(
        (expected) =>
          location.pathname === expected &&
          !document.querySelector('[role="dialog"]') &&
          document.body.style.pointerEvents !== "none",
        {},
        route
      )
      await page.waitForFunction(
        (selector) =>
          document.activeElement === document.querySelector(selector),
        {},
        createSelector
      )
      const focus = await page.$eval(createSelector, (node) => ({
        connected: node.isConnected,
        visible: !!node.getClientRects().length,
        html: node.outerHTML,
        restored: document.activeElement === node,
        focusVisible: node.matches(":focus-visible"),
      }))
      cycles.push({
        dismissal,
        field,
        tabTrapped: true,
        shiftTabTrapped: true,
        focus,
      })
    }
    // Leave the actual form open for the all-rules Dialog scan. The closed
    // Product/Settings page scans remain separate in their existing cases.
    nativeProductTypeProof.finalField = await openNative()
    nativeProductTypeProof.blockedMutationRequests = blockedMutationRequests
    if (blockedMutationRequests.length)
      throw new Error(
        "Native empty Product Type validation attempted a mutation"
      )
  }
  if (isNativeSettingsCase) {
    const proof = {
      setup,
      route,
      selection: null,
      group: null,
      editor: null,
      headingLayout: null,
    }
    nativeSettingsProof = proof
    const selectorByName = (role, name) =>
      `[role="${role}"][aria-label="${name}"]`
    const restoreFixture = async () => {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
      await page.waitForFunction(() => document.querySelector("main h1"))
    }
    // Inspect the entire native page before opening modal navigation or editors.
    const initialAxe = await new AxePuppeteer(page).include("html").analyze()
    proof.initialAxe = {
      violations: initialAxe.violations,
      incomplete: initialAxe.incomplete,
    }
    if (initialAxe.violations.length || initialAxe.incomplete.length)
      issues.push("native-settings:initial_axe_findings")
    await page.screenshot({
      fullPage: true,
      path: screenshotPath.replace(/\.png$/u, "-initial.png"),
    })
    proof.headingLayout = await page.evaluate(() => {
      const heading = document.querySelector("main h1")
      const headingGroup = heading?.parentElement?.parentElement
      const header = headingGroup?.parentElement
      const headingBox = headingGroup?.getBoundingClientRect()
      const headerBox = header?.getBoundingClientRect()
      const controls = headingGroup?.nextElementSibling
      const controlsBox = controls?.getBoundingClientRect()
      const create = [...document.querySelectorAll("main a")].find(
        (node) => node.textContent.trim() === "Create"
      )
      const createBox = create?.getBoundingClientRect()
      return {
        heading: heading?.textContent,
        headingWidth: headingBox?.width,
        headerWidth: headerBox?.width,
        headingClass: header?.className,
        headerDirection: header && getComputedStyle(header).flexDirection,
        headingBottom: headingBox?.bottom,
        controlsTop: controlsBox?.top,
        textBounds: [...headingGroup.querySelectorAll("h1,p")].map((node) => ({
          text: node.textContent,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
        })),
        createBox: createBox && {
          left: createBox.left,
          right: createBox.right,
          top: createBox.top,
          width: createBox.width,
        },
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }
    })
    if (
      setup.includes("regions-list") ||
      setup.includes("refund-reasons") ||
      setup.includes("roles")
    ) {
      if (
        width < 768 &&
        (proof.headingLayout.headerDirection !== "column" ||
          proof.headingLayout.controlsTop <
            proof.headingLayout.headingBottom - 1 ||
          proof.headingLayout.textBounds.some(
            (node) =>
              node.scrollWidth > node.clientWidth + 1 ||
              node.left < 0 ||
              node.right > width
          ))
      )
        issues.push("native-settings:phone_heading_squeezed")
      if (
        proof.headingLayout.createBox &&
        proof.headingLayout.createBox.right > width
      )
        issues.push("native-settings:create_clipped")
    }
    await restoreFixture()
    if (setup.includes("role-detail")) {
      proof.roleAssignmentBoundary = await page.evaluate(() => ({
        checkboxes: [
          ...document.querySelectorAll('main [role="checkbox"]'),
        ].map((node) => ({
          name: node.getAttribute("aria-label"),
          disabled: node.disabled,
          checked: node.getAttribute("aria-checked"),
        })),
        mutationControls: [...document.querySelectorAll("main button,main a")]
          .filter((node) =>
            ["Add", "Remove", "Manage permissions"].includes(
              node.textContent.trim()
            )
          )
          .map((node) => node.textContent.trim()),
        strayZero: [...document.querySelectorAll("main h1")].some((heading) =>
          [...heading.parentElement.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE &&
              node.textContent.trim() === "0"
          )
        ),
      }))
      if (
        proof.roleAssignmentBoundary.checkboxes.length !== 4 ||
        proof.roleAssignmentBoundary.checkboxes.some(
          (node) => !node.disabled || node.checked !== "false" || !node.name
        ) ||
        proof.roleAssignmentBoundary.mutationControls.length ||
        proof.roleAssignmentBoundary.strayZero
      )
        issues.push("native-settings:role_assignment_permission_changed")
      proof.roleSummary = await page.evaluate(() => {
        const wrappers = [
          ...document.querySelectorAll("main .inline-flex.min-w-0.max-w-full"),
        ].filter((node) => node.textContent.includes("+ 1 more"))
        return wrappers.map((node) => {
          const rect = node.getBoundingClientRect()
          const more = [...node.querySelectorAll("span")].find(
            (item) => item.textContent.trim() === "+ 1 more"
          )
          const moreRect = more?.getBoundingClientRect()
          return {
            text: node.textContent,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            moreRight: moreRect?.right,
            parentRight: node.parentElement.getBoundingClientRect().right,
          }
        })
      })
      if (
        proof.roleSummary.length !== 2 ||
        proof.roleSummary.some(
          (node) => node.right > width || node.moreRight > node.parentRight + 1
        )
      )
        issues.push("native-settings:role_summary_clipped")
    }
    if (setup.includes("regions-list") || setup.includes("refund-reasons")) {
      const order = () =>
        page.$$eval("main table thead th", (nodes) =>
          nodes.map((node) => node.textContent.trim())
        )
      const before = await order()
      await page.evaluate(() => {
        window.nativeDragActivationEvents = []
        document.addEventListener("keydown", (event) => {
          if (!event.target?.getAttribute("aria-label")?.startsWith("Reorder "))
            return
          queueMicrotask(() =>
            window.nativeDragActivationEvents.push({
              key: event.key,
              code: event.code,
              prevented: event.defaultPrevented,
              target: event.target.outerHTML,
            })
          )
        })
      })
      await page.focus('main button[aria-label="Reorder Name"]')
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await page.keyboard.press("Space")
      proof.dragActivation = await page.evaluate(() => ({
        events: window.nativeDragActivationEvents,
        announcements: [...document.querySelectorAll("[aria-live]")].map(
          (node) => node.textContent
        ),
      }))
      await page.waitForFunction(
        () =>
          document
            .querySelector('main button[aria-label="Reorder Name"]')
            ?.getAttribute("aria-pressed") === "true"
      )
      // Installed KeyboardSensor attaches its document key listener in the
      // next task. Wait for the active drag's rendered frame before moving.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await page.keyboard.press("ArrowRight")
      await page.waitForFunction(() =>
        [...document.querySelectorAll("[aria-live]")].some((node) =>
          node.textContent.includes("over droppable area created_at")
        )
      )
      proof.dragActivation.afterArrow = await page.evaluate(() => ({
        announcements: [...document.querySelectorAll("[aria-live]")].map(
          (node) => node.textContent
        ),
        events: window.nativeDragActivationEvents,
      }))
      await page.keyboard.press("Space")
      await page.waitForFunction(
        () =>
          document.querySelector("main table thead th")?.textContent.trim() ===
          "Created"
      )
      const afterKeyboard = await order()
      const source = await page.$('main button[aria-label="Reorder Created"]')
      const target = await page.$('main button[aria-label="Reorder Name"]')
      const sourceBox = await source.boundingBox()
      const targetBox = await target.boundingBox()
      const dragClient = await page.createCDPSession()
      const { result: dragDocument } = await dragClient.send(
        "Runtime.evaluate",
        { expression: "document", objectGroup: "native-drag-readiness" }
      )
      const dragListeners = () =>
        dragClient.send("DOMDebugger.getEventListeners", {
          objectId: dragDocument.objectId,
        })
      await page.mouse.move(
        sourceBox.x + sourceBox.width / 2,
        sourceBox.y + sourceBox.height / 2
      )
      await page.mouse.down()
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
        { steps: 12 }
      )
      const duringDrag = (await dragListeners()).listeners.filter(
        (listener) =>
          listener.type === "click" &&
          listener.useCapture &&
          /\.stopPropagation\(\)/u.test(listener.handler?.description ?? "")
      )
      if (duringDrag.length !== 1)
        throw new Error("Exact native drag click shield was not identified")
      const shield = duringDrag[0]
      await page.mouse.up()
      const cleanupDeadline = Date.now() + 2000
      let cleanupReads = 0
      while (
        (await dragListeners()).listeners.some(
          (listener) =>
            listener.type === shield.type &&
            listener.useCapture === shield.useCapture &&
            listener.scriptId === shield.scriptId &&
            listener.lineNumber === shield.lineNumber &&
            listener.columnNumber === shield.columnNumber
        )
      ) {
        if (Date.now() >= cleanupDeadline)
          throw new Error("Native drag click shield did not detach")
        cleanupReads++
        await page.evaluate(() => new Promise(requestAnimationFrame))
      }
      proof.pointerCleanup = {
        exactCapturedShield: {
          type: shield.type,
          useCapture: shield.useCapture,
          scriptId: shield.scriptId,
          lineNumber: shield.lineNumber,
          columnNumber: shield.columnNumber,
          description: shield.handler.description,
        },
        cleanupReads,
        detached: true,
      }
      await dragClient.send("Runtime.releaseObjectGroup", {
        objectGroup: "native-drag-readiness",
      })
      await dragClient.detach()
      await page.waitForFunction(
        () =>
          document.querySelector("main table thead th")?.textContent.trim() ===
          "Name"
      )
      const afterPointer = await order()
      proof.reorder = {
        before,
        afterKeyboard,
        afterPointer,
        nativeKeyboard: true,
        nativePointer: true,
      }
      await page.waitForFunction(
        () => !document.querySelector('main button[aria-pressed="true"]')
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      const sort = await page.$$("main table thead th button")
      let sorted = false
      for (const button of sort) {
        if (
          await button.evaluate((node) => node.textContent.trim() === "Name")
        ) {
          await button.focus()
          proof.independentSortTrigger = await button.evaluate((node) => ({
            html: node.outerHTML,
            focused: document.activeElement === node,
          }))
          await page.keyboard.press("Enter")
          sorted = true
          break
        }
      }
      if (!sorted) throw new Error("Native named sort button was not found")
      await page.waitForFunction(() =>
        [...new URLSearchParams(location.search)].some(
          ([key, value]) =>
            (key === "order" || key.endsWith("_order")) &&
            ["name", "label"].includes(value)
        )
      )
      proof.reorder = {
        before,
        afterKeyboard,
        afterPointer,
        nativeKeyboard: true,
        nativePointer: true,
        independentSortSearch: new URL(page.url()).search,
      }
      await restoreFixture()
    }
    if (
      setup.includes("store") ||
      setup.includes("region-detail") ||
      setup.includes("region-editor")
    ) {
      await page.waitForSelector(
        'main [role="checkbox"][aria-label="Select all"]'
      )
      const header = 'main [role="checkbox"][aria-label="Select all"]'
      const rows = await page.$$eval(
        'main [role="checkbox"][aria-label^="Select "]:not([aria-label="Select all"])',
        (nodes) =>
          nodes.map((node) => ({
            name: node.getAttribute("aria-label"),
            checked: node.getAttribute("aria-checked"),
            disabled: node.hasAttribute("disabled"),
          }))
      )
      if (rows.length !== 2 || rows.some((row) => !row.name.trim()))
        throw new Error(
          "Native Settings fixture requires two identified selections"
        )
      const row = selectorByName("checkbox", rows[0].name)
      await page.focus(row)
      await page.keyboard.press("Space")
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-checked") ===
          "true",
        {},
        row
      )
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-checked") ===
          "mixed",
        {},
        header
      )
      await page.focus(header)
      await page.keyboard.press("Space")
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-checked") ===
          "true",
        {},
        header
      )
      await page.keyboard.press("Space")
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-checked") ===
          "false",
        {},
        header
      )
      proof.selection = {
        rows,
        spaceToggles: true,
        indeterminate: true,
        allPage: true,
        cleared: true,
        routeUnchanged: new URL(page.url()).pathname === route,
      }
    }
    // Settings groups use their translated labels in the actual responsive shell.
    if (width < 1024) {
      await page.focus('button[data-medusa-navigation-toggle="mobile"]')
      await page.keyboard.press("Space")
      await page.waitForSelector('[role="dialog"][data-state="open"]')
    }
    const groupSelector = `${width < 1024 ? '[role="dialog"] ' : ""}[aria-label="General"][aria-expanded]`
    await page.waitForSelector(groupSelector)
    await page.focus(groupSelector)
    await page.keyboard.press("Space")
    await page.waitForFunction(
      (target) =>
        document.querySelector(target)?.getAttribute("aria-expanded") ===
        "false",
      {},
      groupSelector
    )
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      (target) =>
        document.querySelector(target)?.getAttribute("aria-expanded") ===
        "true",
      {},
      groupSelector
    )
    proof.group = await page.$eval(groupSelector, (node) => ({
      name: node.getAttribute("aria-label"),
      expanded: node.getAttribute("aria-expanded"),
      controls: node.getAttribute("aria-controls"),
      focusRetained: document.activeElement === node,
    }))
    if (width < 1024) {
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        () => !document.querySelector('[role="dialog"][data-state="open"]')
      )
      await page.waitForFunction(
        () =>
          document.activeElement ===
          document.querySelector(
            'button[data-medusa-navigation-toggle="mobile"]'
          )
      )
    }
    if (setup.includes("region-editor")) {
      await restoreFixture()
      await page.focus('main button[aria-label="Open actions"]')
      await page.keyboard.press("Enter")
      await page.waitForSelector('a[role="menuitem"][href$="/edit"]')
      await page.focus('a[role="menuitem"][href$="/edit"]')
      await page.keyboard.press("Enter")
      await page.waitForSelector('[role="dialog"] input[name="name"]')
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return (
          dialog &&
          !dialog
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.playState === "running" || animation.pending
            )
        )
      })
      const currency =
        '[role="dialog"] button[role="combobox"][aria-label="Currency"]'
      await page.focus(currency)
      await page.keyboard.press("Space")
      await page.waitForSelector('[role="option"]')
      const currencyOptions = await page.$$eval('[role="option"]', (nodes) =>
        nodes.map((node) => node.textContent.trim())
      )
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        (target) =>
          document.activeElement === document.querySelector(target) &&
          document.querySelector(target)?.getAttribute("aria-expanded") ===
            "false",
        {},
        currency
      )
      if (!(await page.$('[role="dialog"] input[name="name"]')))
        throw new Error("Currency list dismissal closed Region editor")
      proof.currency = {
        name: "Currency",
        options: currencyOptions,
        nativeSelect: true,
        escapeRestores: true,
        valueUnchanged: true,
      }
      const combo = '[role="dialog"] input[role="combobox"]'
      await page.focus(combo)
      await page.keyboard.press("ArrowDown")
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-expanded") ===
          "true",
        {},
        combo
      )
      await page.waitForSelector('[role="option"]')
      const options = await page.$$eval('[role="option"]', (nodes) =>
        nodes.map((node) => node.textContent.trim())
      )
      await page.screenshot({
        fullPage: true,
        path: screenshotPath.replace(/\.png$/u, "-providers-open.png"),
      })
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        (target) =>
          document.querySelector(target)?.getAttribute("aria-expanded") ===
          "false",
        {},
        combo
      )
      if (!(await page.$('[role="dialog"] input[name="name"]')))
        throw new Error("First Escape closed native Region editor")
      const firstEscape = await page.$eval(combo, (node) => ({
        expanded: node.getAttribute("aria-expanded"),
        focusRetained: document.activeElement === node,
      }))
      proof.editor = {
        options,
        firstEscape,
        secondEscapeCloses: false,
        noSave: true,
      }
      await page.keyboard.press("Tab")
      const tabFocus = await page.evaluate(
        () => document.activeElement.outerHTML
      )
      await page.keyboard.down("Shift")
      await page.keyboard.press("Tab")
      await page.keyboard.up("Shift")
      const shiftTabFocus = await page.evaluate(
        () => document.activeElement.outerHTML
      )
      // Native Combobox opens on focus. Close that reopened list before
      // independently dismissing the unchanged drawer from its name field.
      if (
        await page.$eval(
          combo,
          (node) => node.getAttribute("aria-expanded") === "true"
        )
      ) {
        await page.keyboard.press("Escape")
        await page.waitForFunction(
          (target) =>
            document.querySelector(target)?.getAttribute("aria-expanded") ===
            "false",
          {},
          combo
        )
      }
      await page.focus('[role="dialog"] input[name="name"]')
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        (expected) =>
          new URL(location.href).pathname === expected &&
          !document.querySelector('[role="dialog"][data-state="open"]'),
        {},
        route
      )
      proof.editor = {
        options,
        firstEscape,
        secondEscapeCloses: true,
        tabFocus,
        shiftTabFocus,
        noSave: true,
      }
      await restoreFixture()
    }
    nativeSettingsProof = proof
    proof.closedPopoverReadiness = await page.evaluate(() =>
      [
        ...document.querySelectorAll('[role="dialog"][data-state="closed"]'),
      ].map((node) => ({
        html: node.outerHTML.slice(0, 1000),
        opacity: getComputedStyle(node).opacity,
        visibility: getComputedStyle(node).visibility,
        display: getComputedStyle(node).display,
        animations: node.getAnimations({ subtree: true }).map((animation) => ({
          state: animation.playState,
          pending: animation.pending,
        })),
      }))
    )
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll('[role="dialog"][data-state="closed"]'),
      ].every((node) => {
        const style = getComputedStyle(node)
        return (
          ((node.hidden && !node.getClientRects().length) ||
            style.display === "none" ||
            style.visibility === "hidden") &&
          !node
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.playState === "running" || animation.pending
            )
        )
      })
    )
  }
  if (isNativeProductCase) {
    const selector = (label) => `button[aria-label="${label}"]`
    const keyboardOpen = async (target) => {
      await page.focus(target)
      await page.keyboard.press("Space")
    }
    const waitForNativeTooltipReadiness = () =>
      page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll(".shadow-elevation-tooltip")
        ).every((tooltip) => {
          const style = getComputedStyle(tooltip)
          const intentionallyHidden =
            style.display === "none" ||
            style.visibility === "hidden" ||
            (tooltip.hidden && tooltip.getClientRects().length === 0)
          return (
            intentionallyHidden &&
            !tooltip
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.playState === "running" || animation.pending
              )
          )
        })
      )
    const keyboardDismiss = async (label) => {
      // Axe's aria-hidden-focus probe can focus other triggers and leave fading
      // tooltip layers. Test native dismissal after those real layers unmount.
      if (
        await page.evaluate(() =>
          Array.from(
            document.querySelectorAll(".shadow-elevation-tooltip")
          ).some((tooltip) => {
            const style = getComputedStyle(tooltip)
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              !(tooltip.hidden && tooltip.getClientRects().length === 0)
            )
          })
        )
      ) {
        await page.keyboard.press("Escape")
        await waitForNativeTooltipReadiness()
      }
      if (!(await page.$('[role="menu"][data-state="open"]'))) {
        await page.waitForFunction(
          (name) => document.activeElement?.getAttribute("aria-label") === name,
          {},
          label
        )
        return
      }
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        (name) =>
          document.activeElement?.getAttribute("aria-label") === name &&
          !document.querySelector('[role="menu"]') &&
          !document.querySelector("main")?.closest('[aria-hidden="true"]'),
        {},
        label
      )
    }
    const auditState = async (state) => {
      const modalMenu = state.endsWith("-menu")
      await waitForNativeTooltipReadiness()
      let modalProof = null
      if (modalMenu) {
        const trigger = await page.$eval(
          '[role="menu"][data-state="open"]',
          (menu) => {
            const id = menu.getAttribute("aria-labelledby")
            const button = document.getElementById(id)
            if (!button?.getAttribute("aria-label"))
              throw new Error("Native menu has no named invoking button")
            return { id, name: button.getAttribute("aria-label") }
          }
        )
        const requireMenuFocus = async () =>
          page.waitForFunction(
            () =>
              document.activeElement?.closest(
                '[role="menu"][data-state="open"]'
              ) && !document.activeElement.closest('[aria-hidden="true"]')
          )
        await requireMenuFocus()
        await page.keyboard.press("Tab")
        await requireMenuFocus()
        await page.keyboard.down("Shift")
        try {
          await page.keyboard.press("Tab")
        } finally {
          await page.keyboard.up("Shift")
        }
        await requireMenuFocus()
        await page.evaluate(() => {
          const button = document.querySelector(
            'main button[aria-label="Open actions"]'
          )
          if (!button?.closest('[aria-hidden="true"]'))
            throw new Error("Native modal does not hide background content")
          button.focus()
        })
        await requireMenuFocus()
        await page.evaluate(() => {
          const guard = document.querySelector("[data-radix-focus-guard]")
          if (!guard) throw new Error("Native modal focus guard is absent")
          guard.focus()
        })
        await requireMenuFocus()
        await keyboardDismiss(trigger.name)
        await keyboardOpen(`[id="${trigger.id}"]`)
        await requireMenuFocus()
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        )
        await page.mouse.click(5, 60)
        await page.waitForFunction(
          () =>
            !document.querySelector('[role="menu"]') &&
            !document.querySelector("main")?.closest('[aria-hidden="true"]') &&
            document.body.style.pointerEvents !== "none"
        )
        await keyboardOpen(`[id="${trigger.id}"]`)
        await requireMenuFocus()
        modalProof = {
          trigger: trigger.name,
          tabTrapped: true,
          shiftTabTrapped: true,
          hiddenBackgroundRedirected: true,
          focusGuardRedirected: true,
          escapeRestoresTrigger: true,
          outsideClickDismisses: true,
        }
      }
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      if (modalProof)
        await page.waitForFunction(() => {
          const menu = document.querySelector(
            '[role="menu"][data-state="open"]'
          )
          return (
            menu &&
            getComputedStyle(menu).opacity === "1" &&
            !menu
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.playState === "running" || animation.pending
              )
          )
        })
      let axe = await new AxePuppeteer(page).include("html").analyze()
      let transitionScan = null
      if (
        modalProof &&
        [...axe.violations, ...axe.incomplete].some(
          ({ id, nodes }) =>
            id === "color-contrast" &&
            nodes.some(
              ({ html, target }) =>
                html.includes('data-state="closed"') &&
                target.some((selector) =>
                  selector.includes("shadow-elevation-tooltip")
                )
            )
        )
      ) {
        transitionScan = {
          violations: axe.violations,
          incomplete: axe.incomplete,
        }
        await keyboardDismiss(modalProof.trigger)
        await keyboardOpen(selector(modalProof.trigger))
        await page.waitForFunction(() =>
          document.activeElement?.closest('[role="menu"][data-state="open"]')
        )
        await waitForNativeTooltipReadiness()
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        )
        await page.waitForFunction(() => {
          const menu = document.querySelector(
            '[role="menu"][data-state="open"]'
          )
          return (
            menu &&
            getComputedStyle(menu).opacity === "1" &&
            !menu
              .getAnimations({ subtree: true })
              .some(
                (animation) =>
                  animation.playState === "running" || animation.pending
              )
          )
        })
        axe = await new AxePuppeteer(page).include("html").analyze()
      }
      const path = screenshotPath.replace(/\.png$/u, `-${state}.png`)
      await page.screenshot({ fullPage: true, path })
      // Retain every all-rules result. Global document/hidden-background rules
      // are contextual while the proven native modal menu hides the app; the
      // full default page and retained-filter state never use this classifier.
      const modalNodeContexts = modalProof
        ? await page.evaluate(
            (findings) =>
              findings.map(({ id, nodes }) => ({
                id,
                nodes: nodes.map(({ target, html }) =>
                  target.map((selector) => {
                    const element =
                      typeof selector === "string"
                        ? document.querySelector(selector)
                        : null
                    const retainedNode = new DOMParser().parseFromString(
                      html,
                      "text/html"
                    ).body.firstElementChild
                    const retainedNativeGuard = Boolean(
                      retainedNode?.matches(
                        'span[data-radix-focus-guard][tabindex="0"][aria-hidden="true"][data-aria-hidden="true"]'
                      ) &&
                        document.querySelector(
                          'span[data-radix-focus-guard][tabindex="0"][aria-hidden="true"][data-aria-hidden="true"]'
                        )
                    )
                    const hiddenApp = document.querySelector(
                      '[data-aria-hidden="true"][aria-hidden="true"] main'
                    )
                    return {
                      selectorResolved: Boolean(element),
                      retainedNativeGuard,
                      documentRoot:
                        element === document.documentElement &&
                        Boolean(hiddenApp) &&
                        !Array.from(document.querySelectorAll("main")).some(
                          (main) => !main.closest('[aria-hidden="true"]')
                        ),
                      visibleMenu:
                        Boolean(
                          element?.closest(
                            '[role="menu"][data-state="open"]'
                          ) ||
                            (element?.matches(
                              "[data-radix-popper-content-wrapper]"
                            ) &&
                              element.querySelector(
                                '[role="menu"][data-state="open"]'
                              ))
                        ) && !element.closest('[aria-hidden="true"]'),
                      hiddenApp: Boolean(
                        element?.matches(
                          '[data-aria-hidden="true"][aria-hidden="true"]'
                        ) && element.querySelector("main")
                      ),
                      focusGuard: Boolean(
                        element?.hasAttribute("data-radix-focus-guard") ||
                          (!element && retainedNativeGuard)
                      ),
                    }
                  })
                ),
              })),
            [...axe.violations, ...axe.incomplete]
          )
        : []
      const contextualModalFinding = ({ id, nodes }, index) => {
        if (!modalProof) return false
        const contexts = modalNodeContexts[index]?.nodes
        if (
          !nodes.length ||
          !contexts?.length ||
          contexts.some((targets) => !targets.length)
        )
          return false
        if (
          ["landmark-one-main", "page-has-heading-one", "bypass"].includes(id)
        )
          return contexts.every((targets) =>
            targets.every(({ documentRoot }) => documentRoot)
          )
        if (id === "region")
          return contexts.every((targets) =>
            targets.every(({ visibleMenu }) => visibleMenu)
          )
        if (id === "aria-hidden-focus")
          return contexts.every((targets) =>
            targets.every(
              ({ hiddenApp, focusGuard }) => hiddenApp || focusGuard
            )
          )
        return false
      }
      if (
        [...axe.violations, ...axe.incomplete].some(
          (finding, index) => !contextualModalFinding(finding, index)
        )
      ) {
        issues.push(`native-product:${state}:axe_findings`)
      }
      nativeProductStates.push({
        state,
        path,
        axeViolations: axe.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ html, target, failureSummary }) => ({
            html,
            target,
            failureSummary,
          })),
        })),
        axeIncomplete: axe.incomplete.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ html, target, failureSummary }) => ({
            html,
            target,
            failureSummary,
          })),
        })),
        search: new URL(page.url()).search,
        modalProof,
        modalNodeContexts,
        transitionScan,
        focus: await page.evaluate(() => ({
          activeElement: document.activeElement?.outerHTML.slice(0, 1000),
          hiddenAncestor:
            document.activeElement?.closest('[aria-hidden="true"]')?.tagName ??
            null,
          visibleMenus: Array.from(
            document.querySelectorAll('[role="menu"], [role="dialog"]'),
            (element) => ({
              role: element.getAttribute("role"),
              state: element.getAttribute("data-state"),
              expanded: element.getAttribute("aria-expanded"),
              text: element.textContent.trim().slice(0, 200),
            })
          ),
        })),
      })
    }
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    await keyboardOpen('main tbody button[aria-label="Open row actions"]')
    await page.waitForFunction(() =>
      document.activeElement?.closest('[role="menu"][data-state="open"]')
    )
    await page.keyboard.press("Escape")
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="menu"]') &&
        document.activeElement?.getAttribute("aria-label") ===
          "Open row actions"
    )
    await page.evaluate(() => {
      const title = Array.from(
        document.querySelectorAll("main thead button")
      ).find((button) => button.textContent.trim() === "Title")
      if (!title)
        throw new Error("Reachable native title sorting header is absent")
      title.focus()
    })
    await page.keyboard.press("Tab")
    nativeInitialKeyboardProof = await page.evaluate(() => {
      const button = document.activeElement
      if (button?.textContent.trim() !== "SKU" || !button.closest("main thead"))
        throw new Error("Real Tab did not reach the native SKU header")
      const style = getComputedStyle(button)
      return {
        beforeAnyScanner: true,
        rowEscapeRestoredTrigger: true,
        tabReachedSku: true,
        focusVisiblePseudo: button.matches(":focus-visible"),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
        html: button.outerHTML,
      }
    })
    nativeFunctionalTextContrast = await page.evaluate(() => {
      const color = (value) => {
        if (!/^rgba?\(/u.test(value))
          throw new Error(`Unsupported computed color: ${value}`)
        const channels = value.match(/[\d.]+/gu).map(Number)
        return [...channels.slice(0, 3), channels[3] ?? 1]
      }
      const blend = (front, back) =>
        front
          .slice(0, 3)
          .map(
            (channel, index) =>
              channel * front[3] + back[index] * (1 - front[3])
          )
      const luminance = (channels) =>
        channels
          .map((value) => {
            const channel = value / 255
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4
          })
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0
          )
      const contexts = [
        [
          "breadcrumb",
          [...document.querySelectorAll('header a[href="/app/products"]')],
        ],
        [
          "breadcrumb title",
          [...document.querySelectorAll("header span")].filter(
            (node) => node.textContent === "Ashes of the Last Sun"
          ),
        ],
        [
          "nested navigation",
          [
            ...document.querySelectorAll(
              'a[href="/app/collections"],a[href="/app/categories"],a[href="/app/product-options"]'
            ),
          ],
        ],
        [
          "search shortcut",
          [...document.querySelectorAll("button p")].filter(
            (node) => node.textContent === "⌘K"
          ),
        ],
        [
          "search placeholder",
          [...document.querySelectorAll('main input[type="search"]')],
          "::placeholder",
        ],
        [
          "media guidance",
          [...document.querySelectorAll("main p")].filter(
            (node) =>
              node.textContent ===
              "Add media to showcase it in your storefront."
          ),
        ],
      ]
      return contexts.flatMap(([context, nodes, pseudo]) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          if (
            !rect.width ||
            !rect.height ||
            getComputedStyle(node).visibility === "hidden"
          )
            return { context, text: node.textContent, rendered: false }
          const ancestors = []
          for (let element = node; element; element = element.parentElement)
            ancestors.unshift(element)
          let background = [255, 255, 255]
          const layers = ancestors.map((element) => {
            const style = getComputedStyle(element)
            if (style.backgroundImage !== "none" || Number(style.opacity) !== 1)
              throw new Error(
                "Functional text contrast needs a settled solid-color backdrop"
              )
            background = blend(color(style.backgroundColor), background)
            return { tag: element.tagName, background: style.backgroundColor }
          })
          const textStyle = getComputedStyle(node, pseudo)
          if (Number(textStyle.opacity) !== 1)
            throw new Error("Functional text contrast needs opaque text")
          const foreground = blend(color(textStyle.color), background)
          const foregroundLuminance = luminance(foreground),
            backgroundLuminance = luminance(background)
          return {
            context,
            text: pseudo ? node.getAttribute("placeholder") : node.textContent,
            pseudo: pseudo ?? null,
            rendered: true,
            foreground,
            background,
            layers,
            ratio:
              (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
              (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
          }
        })
      )
    })
    if (
      !nativeFunctionalTextContrast.some(
        (node) => node.context === "media guidance" && node.rendered
      ) ||
      nativeFunctionalTextContrast.some(
        (node) => node.rendered && node.ratio < 4.5
      )
    )
      issues.push("native-product:functional_text_contrast")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    await keyboardOpen(selector("Filter"))
    await page.waitForSelector('[role="menuitem"]')
    await auditState("filter-menu")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    await keyboardOpen(selector("Filter"))
    await page.waitForSelector('[role="menuitem"]')
    await page.evaluate(() => {
      const item = Array.from(
        document.querySelectorAll('[role="menuitem"]')
      ).find((element) => element.textContent.trim() === "Manage inventory")
      if (!item) throw new Error("Native Manage inventory filter is missing")
      item.focus()
    })
    await page.keyboard.press("Enter")
    await page.waitForSelector('[role="dialog"]')
    await page.evaluate(() => {
      const choice = Array.from(
        document.querySelectorAll(
          '[role="dialog"] [role="radio"], [role="dialog"] [role="option"], [role="dialog"] button, [role="dialog"] [role="listitem"]'
        )
      ).find((element) => element.textContent.trim() === "Yes")
      if (!choice) throw new Error("Native inventory Yes choice is missing")
      choice.focus()
    })
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () =>
        new URL(location.href).searchParams.get("pv_manage_inventory") ===
        '"true"'
    )
    await page.keyboard.press("Escape")
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="dialog"][data-state="open"]') &&
        document.activeElement?.textContent.trim() === "Yes"
    )
    await page.waitForSelector(selector("Remove: Manage inventory"))
    await page.waitForFunction(
      () => !document.querySelector("main")?.closest('[aria-hidden="true"]')
    )
    await auditState("active-filter")
    await page.focus(selector("Remove: Manage inventory"))
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => !new URL(location.href).searchParams.has("pv_manage_inventory")
    )
    await keyboardOpen(selector("Sort"))
    await page.waitForSelector('[role="menuitemradio"]')
    await auditState("sort-menu")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    await keyboardOpen(selector("Sort"))
    await page.waitForSelector('[role="menuitemradio"]')
    await page.evaluate(() => {
      const item = Array.from(
        document.querySelectorAll('[role="menuitemradio"]')
      ).find((element) => element.textContent.trim() === "Title")
      if (!item) throw new Error("Native Title sort is missing")
      item.focus()
    })
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("pv_order") === "title"
    )
    await keyboardDismiss("Sort")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    const actions = 'main button[aria-label="Open actions"]'
    await keyboardOpen(actions)
    await page.waitForSelector('[role="menuitem"]')
    await auditState("actions-menu")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    await keyboardOpen('main tbody button[aria-label="Open row actions"]')
    await page.waitForSelector('[role="menuitem"]')
    await auditState("row-actions-menu")
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0" })
    await page.waitForFunction(() =>
      document.querySelector("main tbody")?.textContent.includes("Black Vinyl")
    )
    if (
      !(await page.$('button[aria-label="Notifications"]')) ||
      !(await page.$('button[aria-label="Toggle navigation"]'))
    )
      throw new Error("Native app shell controls are unnamed")
    if (width === 390) {
      const focusNavigationTrigger = () =>
        page.evaluate(() => {
          const button = Array.from(
            document.querySelectorAll('button[aria-label="Toggle navigation"]')
          ).find((element) => element.getBoundingClientRect().width > 0)
          if (!button)
            throw new Error("Visible mobile navigation trigger is absent")
          button.focus()
        })
      await focusNavigationTrigger()
      await page.keyboard.press("Space")
      await page.waitForSelector(
        '[role="dialog"][data-state="open"] button[aria-label="Close Navigation"]'
      )
      const closeTarget = await page.$eval(
        'button[aria-label="Close Navigation"]',
        (button) => ({
          name: button.getAttribute("aria-label"),
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })
      )
      if (closeTarget.width < 24 || closeTarget.height < 24)
        throw new Error("Native mobile navigation close target is undersized")
      await page.keyboard.press("Tab")
      await page.waitForFunction(
        () =>
          document.activeElement?.closest(
            '[role="dialog"][data-state="open"]'
          ) && !document.activeElement.closest('[aria-hidden="true"]')
      )
      await page.keyboard.down("Shift")
      try {
        await page.keyboard.press("Tab")
      } finally {
        await page.keyboard.up("Shift")
      }
      await page.waitForFunction(
        () =>
          document.activeElement?.closest(
            '[role="dialog"][data-state="open"]'
          ) && !document.activeElement.closest('[aria-hidden="true"]')
      )
      const drawerPath = screenshotPath.replace(
        /\.png$/u,
        "-navigation-drawer.png"
      )
      await page.waitForFunction(() => {
        const dialog = document.querySelector(
          '[role="dialog"][data-state="open"]'
        )
        return (
          dialog &&
          getComputedStyle(dialog).opacity === "1" &&
          !dialog
            .getAnimations({ subtree: true })
            .some(
              (animation) =>
                animation.playState === "running" || animation.pending
            )
        )
      })
      const visualReadiness = await page.$eval(
        '[role="dialog"][data-state="open"]',
        (dialog) => ({
          opacity: getComputedStyle(dialog).opacity,
          background: getComputedStyle(dialog).backgroundColor,
          pendingAnimations: dialog
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.playState === "running" || animation.pending
            ).length,
        })
      )
      await page.screenshot({ fullPage: true, path: drawerPath })
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        () =>
          !document.querySelector('[role="dialog"]') &&
          document.activeElement?.getAttribute("aria-label") ===
            "Toggle navigation"
      )
      await focusNavigationTrigger()
      await page.keyboard.press("Space")
      await page.waitForSelector('button[aria-label="Close Navigation"]')
      await page.focus('button[aria-label="Close Navigation"]')
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        () =>
          !document.querySelector('[role="dialog"]') &&
          document.activeElement?.getAttribute("aria-label") ===
            "Toggle navigation"
      )
      nativeDrawerProof = {
        closeTarget,
        visualReadiness,
        path: drawerPath,
        tabRetainsVisibleDialogFocus: true,
        shiftTabRetainsVisibleDialogFocus: true,
        escapeRestoresTrigger: true,
        keyboardCloseRestoresTrigger: true,
      }
    }
  }
  if (setup.startsWith("native-order-list-")) {
    const selector =
      'main a.rr-native-order-link[href="/app/orders/order_acceptance"]'
    await page.waitForSelector(selector)
    let reached = false
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab")
      if (
        await page.$eval(
          selector,
          (element) => element === document.activeElement
        )
      ) {
        reached = true
        break
      }
    }
    if (!reached)
      throw new Error("Owned order link is absent from native Tab navigation")
    const link = await page.$eval(selector, (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const outlineExpansion = Math.max(
        0,
        Number.parseFloat(style.outlineWidth) +
          Number.parseFloat(style.outlineOffset)
      )
      let focusClipped = false
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const bounds = parent.getBoundingClientRect()
        const parentStyle = getComputedStyle(parent)
        const clips = (overflow) =>
          ["hidden", "clip", "scroll", "auto"].includes(overflow)
        if (
          (clips(parentStyle.overflowX) &&
            (rect.left - outlineExpansion < bounds.left - 0.5 ||
              rect.right + outlineExpansion > bounds.right + 0.5)) ||
          (clips(parentStyle.overflowY) &&
            (rect.top - outlineExpansion < bounds.top - 0.5 ||
              rect.bottom + outlineExpansion > bounds.bottom + 0.5))
        )
          focusClipped = true
      }
      return {
        name: element.textContent.trim(),
        cursor: style.cursor,
        width: rect.width,
        height: rect.height,
        tabIndex: element.tabIndex,
        focusClipped,
        focusVisible:
          element.matches(":focus-visible") &&
          (style.outlineStyle !== "none" || style.boxShadow !== "none"),
      }
    })
    if (
      link.name !== "#10" ||
      link.cursor !== "pointer" ||
      link.width < 24 ||
      link.height < 24 ||
      link.tabIndex !== 0 ||
      link.focusClipped ||
      !link.focusVisible
    ) {
      throw new Error(
        `Native order link interaction failed: ${JSON.stringify(link)}`
      )
    }
    await page.screenshot({
      path: screenshotPath.replace(/\.png$/u, "-keyboard.png"),
      fullPage: true,
    })
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () =>
        location.pathname === "/app/orders/order_acceptance" &&
        document.querySelector("main h1,h2,h3") &&
        !document.querySelector("main .animate-pulse")
    )
    await page.screenshot({
      path: screenshotPath.replace(/\.png$/u, "-opened.png"),
      fullPage: true,
    })
    await page.goBack({ waitUntil: "domcontentloaded" })
    await page.waitForSelector(selector)
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
  if (inventoryCase) {
    await page.waitForSelector('[role="dialog"] input[name$="0.note"]')
    const stage = inventoryCase[2]
    if (stage === "pending" || stage === "unavailable") {
      await page.waitForFunction(
        (expected) => {
          const dialog = document.querySelector('[role="dialog"]')
          const status = dialog?.querySelector('[role="status"]')
          return (
            status?.textContent.includes(expected) &&
            !dialog.textContent.includes("No inventory level")
          )
        },
        {},
        stage === "pending"
          ? "Checking inventory locations"
          : "Inventory location guidance is unavailable"
      )
      if (stage === "pending") {
        await page.screenshot({
          path: screenshotPath.replace(/\.png$/u, "-pending.png"),
          fullPage: true,
        })
        const pendingAxe = await new AxePuppeteer(page)
          .include('[role="dialog"]')
          .analyze()
        if (pendingAxe.violations.length || pendingAxe.incomplete.length)
          throw new Error(
            "Pending native inventory guidance failed accessibility"
          )
        if (!pendingInventoryRequest)
          throw new Error("Pending inventory request was not captured")
        await pendingInventoryRequest.respond({
          body: JSON.stringify(
            fixtureFor(new URL(pendingInventoryRequest.url()))
          ),
          contentType: "application/json",
          headers: {
            "access-control-allow-credentials": "true",
            "access-control-allow-origin": acceptanceOrigin,
            "cache-control": "no-store",
          },
          status: 200,
        })
      }
    }
    if (stage !== "unavailable") {
      await page.waitForFunction(
        (missing) => {
          const dialog = document.querySelector('[role="dialog"]')
          return (
            dialog &&
            !dialog.querySelector('[role="status"]') &&
            dialog.textContent.includes("No inventory level") === missing
          )
        },
        {},
        stage === "missing"
      )
    }
    if (inventoryRequests.length !== 1)
      throw new Error(
        "Native inventory guidance did not use one selected-variant read"
      )
    const ids = inventoryRequests[0]
      .filter(([key]) => /^id(?:\[.*\])?$/u.test(key))
      .map(([, value]) => value)
    if (ids.length !== 1 || ids[0] !== "variant_acceptance")
      throw new Error(
        "Native inventory guidance omitted the canonical selected variant"
      )
  }
  if (isPartialReturnCase) {
    await page.waitForSelector(
      'main a[href="/app/orders/order_acceptance/returns/return_acceptance/receive"]'
    )
  }
  if (isSummaryCase) {
    await page.waitForFunction(
      (sku) => document.querySelector("main")?.textContent.includes(sku),
      {},
      summaryItem.variant_sku
    )
    const overlaps = await page.evaluate((sku) => {
      const main = document.querySelector("main")
      const text = [...main.querySelectorAll("p")].find(
        (e) => e.textContent === sku
      )
      if (!text) return { missing: true }
      const row = text.closest('[class*="grid-cols-2"]')
      if (!row) return { missingRow: true }
      const cells = [...row.children]
      const a = cells[0].getBoundingClientRect()
      const b = cells[1].getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(text)
      return {
        mainOverflow: main.scrollWidth > main.clientWidth + 1,
        rowOverflow: row.scrollWidth > row.clientWidth + 1,
        overlap: [...range.getClientRects()].some(
          (r) =>
            Math.min(r.right, b.right) - Math.max(r.left, b.left) > 0.5 &&
            Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 0.5
        ),
        cellOverlap:
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5,
      }
    }, summaryItem.variant_sku)
    if (Object.values(overlaps).some(Boolean)) {
      await page.screenshot({ path: screenshotPath, fullPage: true })
      throw new Error(
        `Native order Summary does not fit: ${JSON.stringify(overlaps)}`
      )
    }
    if (width === 390) {
      await page.bringToFront()
      const before = await page.evaluate(() => navigator.clipboard.readText())
      let copied
      try {
        await page.click('button[aria-label="Copy item SKU"]')
        await page.waitForFunction(
          (sku) =>
            navigator.clipboard.readText().then((value) => value === sku),
          {},
          summaryItem.variant_sku
        )
        copied = await page.evaluate(() => navigator.clipboard.readText())
        if (copied !== summaryItem.variant_sku)
          throw new Error(
            "Native SKU clipboard bytes differ from the rendered SKU"
          )
      } finally {
        await page.evaluate(
          (value) => navigator.clipboard.writeText(value),
          before
        )
      }
      const restored = await page.evaluate(() => navigator.clipboard.readText())
      if (restored !== before)
        throw new Error("Owned browser clipboard was not restored")
      nativeClipboardProof = {
        expected: summaryItem.variant_sku,
        copied,
        beforeByteLength: new TextEncoder().encode(before).length,
        exactBytes: true,
        restored: true,
        navigatorRead: true,
        nativeClick: true,
      }
    }
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
  if (setup === "native-allocation" || setup === "native-allocation-kit") {
    await page.waitForSelector('[role="dialog"] input[name^="quantity."]')
    await page.click('[role="dialog"] [role="combobox"]')
    await page.waitForSelector('[role="option"]')
    await page.click('[role="option"]')
    await page.waitForFunction(() => {
      const quantity = document.querySelector('input[name^="quantity."]')
      return quantity && !quantity.disabled
    })
    await page.focus('input[name^="quantity."]')
    if (setup === "native-allocation-kit") {
      await page.focus(
        '[role="dialog"] button[aria-expanded]:not([role="combobox"])'
      )
      await page.keyboard.press("Space")
      await page.waitForFunction(() =>
        document.querySelector(
          '[role="dialog"] button[aria-expanded="true"]:not([role="combobox"])'
        )
      )
      await page.waitForSelector(
        'input[aria-label="Quantity · Acceptance Shirt · M · Acceptance Shirt M"]'
      )
    }
  }
  if (setup === "native-return-receive") {
    await page.waitForSelector('input[name="items.0.quantity"]')
    const label = await page.$eval('input[name="items.0.quantity"]', (input) =>
      input.getAttribute("aria-label")
    )
    if (label !== "Quantity · Acceptance Shirt · M") {
      throw new Error(
        "Native return receive quantity omits the purchased option"
      )
    }
    await page.focus('input[name="items.0.quantity"]')
    const damagedName =
      "How many of the items are damaged? · Acceptance Shirt · M"
    await page.click(`button[aria-label="${damagedName}"]`)
    await page.waitForSelector('input[name="items.0.dismissed_quantity"]')
    const damagedLabel = await page.$eval(
      'input[name="items.0.dismissed_quantity"]',
      (input) => input.getAttribute("aria-label")
    )
    if (damagedLabel !== damagedName) {
      throw new Error(
        "Native damaged-item quantity omits its action and option"
      )
    }
    await page.screenshot({
      path: screenshotPath.replace(/\.png$/u, "-damaged.png"),
      fullPage: true,
    })
    await page.click(`button[aria-label="${damagedName}"]`)
    await page.waitForSelector('input[name="items.0.dismissed_quantity"]', {
      hidden: true,
    })
    await page.focus('input[name="items.0.quantity"]')
  }
  if (setup === "native-refund-controls") {
    await page.waitForSelector(
      '[role="dialog"] button[aria-label="Refund Reason"]'
    )
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
    const itemNames = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const quantity = dialog?.querySelector('input[type="number"]')
      const names = Array.from(
        dialog?.querySelectorAll("[aria-label]") ?? [],
        (element) => element.getAttribute("aria-label")
      )
      return {
        quantity: quantity?.getAttribute("aria-label"),
        rawTranslation: names.some((name) =>
          /orders\.(?:returns|exchanges)\./u.test(name)
        ),
      }
    })
    if (itemNames.quantity !== "Quantity Acceptance Shirt M")
      throw new Error("Native quantity label omitted its purchased variant")
    if (itemNames.rawTranslation)
      throw new Error("Native exchange label exposed a translation key")
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
  if (setup === "catalog-create-bundle-stock") {
    const kindButtons = await page.$$("button")
    let selected = false
    for (const button of kindButtons) {
      if (
        (await button.evaluate((element) => element.textContent)).startsWith(
          "Fixed bundle"
        )
      ) {
        await button.click()
        selected = true
        break
      }
    }
    if (!selected) throw new Error("Fixed bundle kind is unavailable")
    await clickButton("Continue")
    await page.waitForSelector("#catalog-create-title")
    await page.type("#catalog-create-title", "Acceptance Fixed Bundle")
    await clickButton("Continue")
    await page.waitForSelector("#catalog-create-add-bundle-component")
    await clickButton("Add included product")
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '[aria-label="Customer availability after publish: In stock"]'
          )
          ?.textContent.includes("18 complete bundles"),
      { timeout: 10000 }
    )
    const quantity = 'input[id^="component-"][id$="-quantity"]'
    await page.click(quantity)
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyA")
    await page.keyboard.up("Control")
    await page.type(quantity, "2")
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '[aria-label="Customer availability after publish: In stock"]'
          )
          ?.textContent.includes("9 complete bundles"),
      { timeout: 10000 }
    )
    if (
      fixtureRequests.get("/admin/products/product_acceptance/variants") !== 1
    ) {
      throw new Error("Component stock did not use one selected native read")
    }
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
    await page.screenshot({
      path: screenshotPath.replace(/\.png$/u, "-validation.png"),
      fullPage: true,
    })
    // Preserve the focused validation state above, then bring the filing
    // guidance into view so contrast analysis can resolve its real backdrop.
    await page.evaluate(() =>
      document.querySelector("main .max-w-4xl")?.scrollIntoView({
        block: "center",
        behavior: "instant",
      })
    )
    await page.waitForFunction(() => {
      const guidance = document.querySelector("main .max-w-4xl")
      if (!guidance) return false
      const box = guidance.getBoundingClientRect()
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2
      )
      return (
        box.top >= 0 &&
        box.bottom <= innerHeight &&
        topmost &&
        (guidance.contains(topmost) || topmost.contains(guidance))
      )
    })
    const filingLinkOverlaps = await page.evaluate(() => {
      const guidance = document.querySelector("main .max-w-4xl")
      const links = [...guidance.querySelectorAll("a")]
      const walk = document.createTreeWalker(guidance, NodeFilter.SHOW_TEXT)
      const textRects = []
      let node
      while ((node = walk.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest("a"))
          continue
        const range = document.createRange()
        range.selectNodeContents(node)
        textRects.push(...range.getClientRects())
      }
      return links.some((link) => {
        const box = link.getBoundingClientRect()
        return textRects.some(
          (text) =>
            Math.min(box.right, text.right) - Math.max(box.left, text.left) >
              0.5 &&
            Math.min(box.bottom, text.bottom) - Math.max(box.top, text.top) >
              0.5
        )
      })
    })
    if (filingLinkOverlaps)
      throw new Error("Tax filing link overlaps neighboring text")
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
    search: location.search,
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
  const documentFocusObservations = []
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
      if (element === document.body || element === document.documentElement) {
        return { documentFocus: true, tag: element.tagName.toLowerCase() }
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
    if (focused?.documentFocus)
      documentFocusObservations.push({ index, ...focused })
    else if (focused) focusOrder.push(focused)
  }

  const findingCodes = [
    ...(!hasMain ? ["main_landmark_missing"] : []),
    ...(`${layout.path}${layout.search}` !==
    (isNativeProductTypeCase ? "/app/settings/product-types/create" : route)
      ? ["route_mismatch"]
      : []),
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
        documentFocusObservations,
        fixtureRequests: Object.fromEntries(fixtureRequests),
        findingCodes: uniqueFindingCodes,
        issues: issues.slice(0, 20),
        layout,
        nativeProductStates,
        nativeClipboardProof,
        nativeDrawerProof,
        nativeInitialKeyboardProof,
        nativeFunctionalTextContrast,
        nativeProductTypeProof,
        nativeSettingsProof,
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
  if (isNativeProductTypeCase && page) {
    await page
      .screenshot({
        fullPage: true,
        path: screenshotPath.replace(/\.png$/u, "-failure.png"),
      })
      .catch(() => undefined)
    console.error(
      JSON.stringify({
        nativeProductTypeProof,
        failureDom: await page
          .evaluate(() => ({
            pathname: location.pathname,
            activeElement:
              document.activeElement?.tagName === "BODY"
                ? "<body>"
                : document.activeElement?.outerHTML,
            dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
              (node) => node.outerHTML.slice(0, 4000)
            ),
            create: [...document.querySelectorAll("main a")]
              .filter((node) => node.textContent.trim() === "Create")
              .map((node) => ({
                html: node.outerHTML,
                hidden: !!node.closest('[aria-hidden="true"], [inert]'),
                visible: !!node.getClientRects().length,
              })),
          }))
          .catch(() => null),
      })
    )
  }
  if (isNativeSettingsCase && page) {
    await page
      .screenshot({
        fullPage: true,
        path: screenshotPath.replace(/\.png$/u, "-failure.png"),
      })
      .catch(() => undefined)
    console.error(
      JSON.stringify({
        nativeSettingsProof,
        failureDom: await page
          .evaluate(() => ({
            controls: Array.from(
              document.querySelectorAll(
                'button,[role="checkbox"],[role="combobox"]'
              ),
              (node) => node.outerHTML.slice(0, 1200)
            ),
            activeElement: document.activeElement?.outerHTML.slice(0, 1200),
            location: `${location.pathname}${location.search}`,
            dragEvents: window.nativeDragActivationEvents,
            announcements: [...document.querySelectorAll("[aria-live]")].map(
              (node) => node.textContent
            ),
            headers: [...document.querySelectorAll("main thead th")].map(
              (node) => ({
                text: node.textContent,
                rect: node.getBoundingClientRect().toJSON(),
              })
            ),
          }))
          .catch(() => null),
      })
    )
  }
  if (isNativeProductCase && page) {
    await page
      .screenshot({
        fullPage: true,
        path: screenshotPath.replace(/\.png$/u, "-failure.png"),
      })
      .catch(() => undefined)
    console.error(
      JSON.stringify({
        nativeProductStates,
        failureFocus: await page
          .evaluate(() => ({
            activeElement: document.activeElement?.outerHTML.slice(0, 1000),
            tooltips: Array.from(
              document.querySelectorAll(".shadow-elevation-tooltip"),
              (element) => ({
                html: element.outerHTML.slice(0, 1500),
                animation: getComputedStyle(element).animation,
                opacity: getComputedStyle(element).opacity,
                animations: element.getAnimations().map((animation) => ({
                  state: animation.playState,
                  currentTime: animation.currentTime,
                })),
              })
            ),
            menus: Array.from(
              document.querySelectorAll('[role="menu"], [role="dialog"]'),
              (element) => ({
                state: element.getAttribute("data-state"),
                text: element.textContent.trim().slice(0, 200),
              })
            ),
          }))
          .catch(() => null),
      })
    )
  }
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
