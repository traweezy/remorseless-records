import type { Page } from "@playwright/test"

import type { CheckoutProjection } from "@/features/checkout/types/checkout"
import { cartEnvelopeFrom } from "@/lib/cart/snapshot"
import type { ProductSearchResponse } from "@/lib/search/search"

const revision = `v1.${"a".repeat(43)}`

const cartItem = {
  id: "cali_LAUNCH",
  title: "Pathological Decomposition",
  product_title: "Pathological Decomposition",
  product_handle: "music-release-pathologist-pathological-decomposition",
  variant_id: "variant_LAUNCH",
  variant_title: "LP",
  quantity: 1,
  unit_price: 20,
  subtotal: 20,
  total: 20,
  thumbnail: null,
  variant: {
    id: "variant_LAUNCH",
    title: "LP",
    manage_inventory: true,
    allow_backorder: false,
    inventory_quantity: 5,
  },
  product: {
    id: "prod_LAUNCH",
    handle: "music-release-pathologist-pathological-decomposition",
  },
}

const cart = () => ({
  id: "cart_LAUNCH",
  currency_code: "usd",
  subtotal: 20,
  total: 20,
  items: [cartItem],
})

const address = {
  firstName: "Ada",
  lastName: "Lovelace",
  address1: "123 Test Street",
  address2: null,
  city: "Phoenix",
  province: "AZ",
  postalCode: "85001",
  countryCode: "us",
  phone: null,
} as const

const catalogSearchFixture: ProductSearchResponse = {
  hits: [
    {
      id: "prod_LAUNCH",
      handle: "music-release-pathologist-pathological-decomposition",
      title: "Pathological Decomposition",
      artist: "Pathologist",
      album: "Pathological Decomposition",
      slug: {
        artist: "Pathologist",
        album: "Pathological Decomposition",
        artistSlug: "pathologist",
        albumSlug: "pathological-decomposition",
      },
      subtitle: null,
      thumbnail: null,
      collectionTitle: null,
      defaultVariant: {
        id: "variant_LAUNCH",
        title: "LP",
        currency: "usd",
        amount: 20,
        hasPrice: true,
        inStock: true,
        stockStatus: "in_stock",
        inventoryQuantity: 5,
      },
      formats: ["Vinyl"],
      genres: ["Death Metal"],
      metalGenres: ["Death Metal"],
      categories: [],
      categoryHandles: [],
      variantTitles: ["LP"],
      artistNames: ["Pathologist"],
      format: "Vinyl",
      priceAmount: 20,
      priceMin: 20,
      priceMax: 20,
      stockStatus: "in_stock",
      productType: "music-release",
      status: "published",
    },
  ],
  total: 1,
  offset: 0,
  facets: {
    genres: { "Death Metal": 1 },
    metalGenres: { "Death Metal": 1 },
    format: { Vinyl: 1 },
    categories: {},
    variants: { LP: 1 },
    productTypes: { "music-release": 1 },
    availabilityStates: { in_stock: 1 },
    stockStatuses: { in_stock: 1 },
    bundleTypes: {},
  },
  hasMore: false,
  nextOffset: 1,
}

const catalogFilterFixtures: Record<string, unknown> = {
  "/api/catalog/filters/product-types": {
    options: [{ value: "music-release", label: "Music Releases", count: 1 }],
  },
  "/api/catalog/filters/genres": {
    options: [{ value: "death-metal", label: "Death Metal", count: 1 }],
  },
  "/api/catalog/filters/formats": {
    options: [{ value: "Vinyl", label: "Vinyl", count: 1 }],
  },
  "/api/catalog/filters/price-range": {
    range: { min: 20, max: 20, currency: "usd" },
  },
}

const catalogProductFixture = {
  id: "prod_LAUNCH",
  handle: "music-release-pathologist-pathological-decomposition",
  title: "Pathological Decomposition",
  description: "A deterministic launch-acceptance product.",
  thumbnail: null,
  images: [],
  variants: [
    {
      id: "variant_LAUNCH",
      title: "LP",
      calculated_price: {
        calculated_amount: 20,
        currency_code: "usd",
      },
      inventory_quantity: 5,
      manage_inventory: true,
      allow_backorder: false,
      metadata: { inventory_count_status: "verified" },
    },
  ],
}

export const installCatalog = async (page: Page): Promise<void> => {
  await page.route("**/api/catalog/filters/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const fixture = catalogFilterFixtures[pathname]
    if (!fixture) {
      await route.abort("failed")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    })
  })
  await page.route("**/api/search/products", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(catalogSearchFixture),
    })
  })
  await page.route("**/api/products/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ product: catalogProductFixture }),
    })
  })
}

const checkoutProjection = (
  state: "needs_contact" | "needs_address" | "ready_for_payment",
  total: number
): CheckoutProjection => ({
  state,
  revision,
  cart: {
    items: [
      {
        availableQuantity: 5,
        id: cartItem.id,
        productHandle: cartItem.product_handle,
        productTitle: cartItem.product_title,
        quantity: 1,
        subtotal: 20,
        thumbnail: null,
        unitPrice: 20,
        variantTitle: "LP",
      },
    ],
    totals: {
      taxCollectionMode: "collect",
      currencyCode: "usd",
      subtotal: 20,
      discountTotal: total === 0 ? 20 : 0,
      shippingTotal: 0,
      taxTotal: 0,
      total,
    },
    contact: state === "needs_contact" ? null : { email: "buyer@example.test" },
    deliveryAddress: state === "ready_for_payment" ? address : null,
    shippingMethod:
      state === "ready_for_payment"
        ? {
            id: "casm_LAUNCH",
            name: "Standard",
            optionId: "so_LAUNCH",
            amount: 0,
          }
        : null,
  },
  payment: {
    provider: null,
    clientSecret: null,
    status: null,
    canRestart: false,
  },
  confirmation: null,
})

export const installPopulatedCart = async (page: Page): Promise<void> => {
  await page.route("**/api/cart", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartEnvelopeFrom({ cart: cart() })),
    })
  })
}

export const installCheckout = async (
  page: Page,
  mode: "validation" | "free-ready"
): Promise<void> => {
  await installPopulatedCart(page)
  let checkout =
    mode === "validation"
      ? checkoutProjection("needs_contact", 20)
      : checkoutProjection("ready_for_payment", 0)

  await page.route("**/api/checkout{,/**}", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/checkout" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout }),
      })
      return
    }
    if (
      pathname === "/api/checkout/shipping-options" &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shippingOptions: [
            {
              id: "so_LAUNCH",
              name: "Standard",
              description: "Tracked delivery",
              amount: 0,
              currencyCode: "usd",
              insufficientInventory: false,
            },
          ],
        }),
      })
      return
    }
    if (
      pathname === "/api/checkout/contact" &&
      request.method() === "PUT" &&
      mode === "validation"
    ) {
      checkout = checkoutProjection("needs_address", 20)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout }),
      })
      return
    }
    if (pathname === "/api/checkout/complete" && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          checkout: {
            state: "order_confirmed",
            confirmation: { orderNumber: "1042" },
          },
        }),
      })
      return
    }
    await route.fulfill({ status: 404, body: "Unexpected checkout request" })
  })
}

export const installConfirmation = async (page: Page): Promise<void> => {
  await page.route("**/api/checkout/confirmation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        receipt: {
          orderNumber: "1042",
          placedAt: "2026-08-31T16:30:00.000Z",
          email: "buyer@example.test",
          items: [
            {
              id: "item_LAUNCH",
              title: "Pathological Decomposition",
              variantTitle: "LP",
              thumbnail: null,
              quantity: 1,
              total: 20,
            },
          ],
          deliveryAddress: {
            firstName: address.firstName,
            lastName: address.lastName,
            address1: address.address1,
            address2: address.address2,
            city: address.city,
            province: address.province,
            postalCode: address.postalCode,
            countryCode: address.countryCode,
          },
          deliveryMethod: "Standard",
          totals: {
            taxCollectionMode: "collect",
            currencyCode: "usd",
            subtotal: 20,
            discountTotal: 0,
            shippingTotal: 5,
            taxTotal: 1.5,
            total: 26.5,
          },
        },
      }),
    })
  })
}

export const installRecovery = async (page: Page): Promise<void> => {
  await page.route("**/api/checkout/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkout: { state: "payment_processing" } }),
    })
  })
}
