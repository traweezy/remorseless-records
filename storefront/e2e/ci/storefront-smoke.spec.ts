import { expect, test, type Page } from "@playwright/test"

import type {
  ProductSearchRequest,
  ProductSearchResponse,
} from "@/lib/search/search"
import { cartEnvelopeFrom } from "@/lib/cart/snapshot"

const catalogSearchFixture: ProductSearchResponse = {
  hits: [
    {
      id: "prod_CIPATHOLOGIST",
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
        id: "variant_CIPATHOLOGISTCD",
        title: "CD",
        currency: "usd",
        amount: 15,
        hasPrice: true,
        inStock: true,
        stockStatus: "in_stock",
        inventoryQuantity: 10,
      },
      formats: ["CD"],
      genres: ["Death Metal", "Grind"],
      metalGenres: ["Death Metal", "Grind"],
      categories: [],
      categoryHandles: [],
      variantTitles: ["CD"],
      artistNames: ["Pathologist"],
      format: "CD",
      priceAmount: 15,
      priceMin: 15,
      priceMax: 15,
      stockStatus: "in_stock",
      productType: "music-release",
      status: "published",
    },
  ],
  total: 1,
  offset: 0,
  facets: {
    genres: { "Death Metal": 1, Grind: 1 },
    metalGenres: { "Death Metal": 1, Grind: 1 },
    format: { CD: 1 },
    categories: {},
    variants: { CD: 1 },
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
    options: [
      { value: "music-release", label: "Music Releases", count: 442 },
      { value: "merch", label: "Merchandise", count: 4 },
      { value: "fixed-bundle", label: "Fixed Bundles", count: 14 },
      { value: "mystery-bundle", label: "Mystery Bundles", count: 1 },
    ],
  },
  "/api/catalog/filters/genres": {
    options: [
      { value: "death-metal", label: "Death Metal", count: 379 },
      { value: "grind", label: "Grind", count: 64 },
    ],
  },
  "/api/catalog/filters/formats": {
    options: [
      { value: "Vinyl", label: "Vinyl", count: 125 },
      { value: "CD", label: "CD", count: 281 },
      { value: "Cassette", label: "Cassette", count: 131 },
      { value: "DVD", label: "DVD", count: 1 },
    ],
  },
  "/api/catalog/filters/price-range": {
    range: { min: 1, max: 56, currency: "usd" },
  },
}

const productDetailFixture = {
  id: "prod_CIPATHOLOGIST",
  handle: "music-release-pathologist-pathological-decomposition",
  title: "Pathological Decomposition",
  subtitle: "Pathologist",
  description: "A test pressing used for the cart interaction journey.",
  thumbnail: null,
  images: [],
  variants: [
    {
      id: "variant_CIPATHOLOGISTCD",
      title: "CD",
      calculated_price: {
        calculated_amount: 15,
        currency_code: "usd",
      },
      inventory_quantity: 10,
      manage_inventory: true,
      allow_backorder: false,
      metadata: {
        inventory_count_status: "verified",
      },
    },
  ],
}

const createPaginationFixture = (
  offset: number,
  limit: number
): ProductSearchResponse => ({
  ...catalogSearchFixture,
  hits: Array.from({ length: limit }, (_, index) => {
    const sequence = offset + index + 1
    const baseHit = catalogSearchFixture.hits[0]

    return {
      ...baseHit,
      id: `prod_CIPAGINATION${sequence}`,
      handle: `music-release-ci-pagination-${sequence}`,
      title: `Pagination Test ${sequence}`,
      album: `Pagination Test ${sequence}`,
      slug: {
        ...baseHit.slug,
        album: `Pagination Test ${sequence}`,
        albumSlug: `pagination-test-${sequence}`,
      },
    }
  }),
  total: 461,
  offset,
  hasMore: offset + limit < 461,
  nextOffset: Math.min(offset + limit, 461),
})

const interactivePointerSelector = [
  'a[href]:not([aria-disabled="true"])',
  'button:not(:disabled):not([aria-disabled="true"])',
  "summary",
  "select:not(:disabled)",
  '[role="button"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="link"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="option"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="tab"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="checkbox"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="radio"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="switch"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  '[role="slider"]:not(:disabled):not([aria-disabled="true"]):not([data-disabled])',
  "label[for]",
  'input:not(:disabled):is([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="file"],[type="color"])',
].join(",")

const expectVisibleInteractivePointers = async (page: Page): Promise<void> => {
  const offenders = await page
    .locator(interactivePointerSelector)
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const element = node as HTMLElement
        const bounds = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const clipped =
          style.clip !== "auto" ||
          (style.clipPath !== "none" && style.clipPath !== "")

        if (
          bounds.width <= 0 ||
          bounds.height <= 0 ||
          clipped ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.pointerEvents === "none" ||
          style.cursor === "pointer"
        ) {
          return []
        }

        return [
          {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            label: (
              element.getAttribute("aria-label") ??
              element.textContent ??
              ""
            )
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 100),
            cursor: style.cursor,
          },
        ]
      })
    )

  expect(offenders).toEqual([])
}

const expectVisibleInteractiveTargets = async (page: Page): Promise<void> => {
  const offenders = await page
    .locator(
      "button:not(:disabled), a[href], input:not([type=hidden]):not(:disabled), [role=radio]"
    )
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const element = node as HTMLElement
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          style.pointerEvents === "none" ||
          (rect.width >= 24 && rect.height >= 24)
        ) {
          return []
        }

        return [
          {
            height: rect.height,
            label:
              element.getAttribute("aria-label") ??
              element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
              "",
            role: element.getAttribute("role"),
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute("type"),
            width: rect.width,
          },
        ]
      })
    )

  expect(offenders).toEqual([])
}

const rejectNonEssentialCookies = async (page: Page): Promise<void> => {
  const reject = page.getByRole("button", { name: "Reject non-essential" })
  const appeared = await reject
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(
      () => true,
      () => false
    )

  if (!appeared) {
    return
  }

  await reject.click()
  await expect(reject).toBeHidden()
}

test("homepage hydrates every curated shelf without client errors", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" })

  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const response = await page.goto("/", { waitUntil: "domcontentloaded" })
  expect(response?.status()).toBeLessThan(400)

  for (const heading of ["New in Store", "Featured Picks", "Latest News"]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first()
    ).toBeVisible()
  }
  await expect(page.locator('[data-testid="hero-tagline"]:visible')).toHaveText(
    "...Death...Doom...and everything in between"
  )

  await expect(
    page.getByRole("main").locator(".product-carousel__splide")
  ).toHaveCount(3)
  await expect(
    page.getByRole("button", { name: /^(Play|Pause) .+ carousel$/ })
  ).toHaveCount(0)
  const newInStore = page.getByRole("region", { name: "New in Store" })
  await expect(
    newInStore.getByText("NEW", { exact: true }).first()
  ).toBeVisible()
  await expect(
    newInStore.getByText("NEW RELEASE", { exact: true })
  ).toHaveCount(0)

  await page.waitForTimeout(500)
  expect(pageErrors).toEqual([])

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    activeCardContentLeft: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".product-carousel__splide .splide__slide.is-active"
      )
    )
      .map((slide) =>
        slide
          .querySelector<HTMLElement>(".product-carousel__card > *")
          ?.getBoundingClientRect()
      )
      .filter(
        (bounds): bounds is DOMRect =>
          bounds !== undefined &&
          bounds.right > 0 &&
          bounds.left < window.innerWidth
      )
      .map((bounds) => bounds.left),
    carouselListGaps: Array.from(
      document.querySelectorAll<HTMLElement>(
        ".product-carousel__splide .splide__list"
      )
    ).map((list) => window.getComputedStyle(list).columnGap),
    heroTaglines: Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="hero-tagline"]')
    )
      .map((tagline) => tagline.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0)
      .map((bounds) => ({ left: bounds.left, right: bounds.right })),
  }))
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.activeCardContentLeft.length).toBeGreaterThan(0)
  for (const contentLeft of metrics.activeCardContentLeft) {
    expect(contentLeft).toBeGreaterThanOrEqual(-1)
  }
  for (const gap of metrics.carouselListGaps) {
    expect(gap === "normal" || gap === "0px").toBe(true)
  }
  expect(metrics.heroTaglines.length).toBeGreaterThan(0)
  for (const tagline of metrics.heroTaglines) {
    expect(tagline.left).toBeGreaterThanOrEqual(0)
    expect(tagline.right).toBeLessThanOrEqual(metrics.viewportWidth)
  }
})

test("visible interactive controls consistently use pointer cursors", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expectVisibleInteractivePointers(page)

  await rejectNonEssentialCookies(page)

  const openNavigation = page.getByRole("button", {
    name: "Open navigation",
  })
  if (await openNavigation.isVisible()) {
    await openNavigation.click()
    await expectVisibleInteractivePointers(page)
    await page.getByRole("button", { name: "Close navigation" }).click()
  }

  await page.goto("/catalog", { waitUntil: "domcontentloaded" })
  await expectVisibleInteractivePointers(page)
  await page.getByRole("combobox", { name: "Sort products" }).click()
  await expectVisibleInteractivePointers(page)
  await page.keyboard.press("Escape")

  await page.goto("/discography", { waitUntil: "domcontentloaded" })
  await expectVisibleInteractivePointers(page)
  const mobileDiscographyFilters = page.getByRole("button", {
    name: /^Show filters/,
  })
  if (await mobileDiscographyFilters.isVisible()) {
    await mobileDiscographyFilters.click()
  }
  await page.getByRole("combobox", { name: "Filter by availability" }).click()
  await expectVisibleInteractivePointers(page)
  await page.keyboard.press("Escape")
  const closeDiscographyFilters = page.getByRole("button", {
    name: "Close discography filters",
  })
  if (await closeDiscographyFilters.isVisible()) {
    await closeDiscographyFilters.click()
  }
  await expect(
    page.getByRole("combobox", { name: "Sort discography" })
  ).toContainText("Catalog # high–low")

  await page.goto("/contact", { waitUntil: "domcontentloaded" })
  await expectVisibleInteractivePointers(page)

  await page.goto("/cookies", { waitUntil: "domcontentloaded" })
  await expectVisibleInteractivePointers(page)
})

test("cart drawer stays usable and contained on mobile devices", async ({
  page,
}, testInfo) => {
  const cartItem = {
    id: "cali_CIMOBILE",
    title: "Pathological Decomposition",
    product_title: "Pathological Decomposition",
    product_handle: "music-release-pathologist-pathological-decomposition",
    variant_id: "variant_CIPATHOLOGISTLP",
    variant_title: "LP",
    quantity: 2,
    unit_price: 18,
    subtotal: 36,
    total: 36,
    thumbnail: null,
    variant: {
      id: "variant_CIPATHOLOGISTLP",
      title: "LP",
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 3,
    },
    product: {
      id: "prod_CIPATHOLOGIST",
      handle: "music-release-pathologist-pathological-decomposition",
      metadata: {
        artist_names: ["Pathologist"],
        catalog_import: {
          product_type: "music_release",
        },
      },
    },
  }
  let cartItems = [cartItem]
  const cartResponse = () => ({
    ...cartEnvelopeFrom({
      cart: {
        id: "cart_CIMOBILE",
        currency_code: "usd",
        subtotal: cartItems.length ? 36 : 0,
        total: cartItems.length ? 36 : 0,
        items: cartItems,
      },
    }),
  })

  await page.route("**/api/cart", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartResponse()),
    })
  })
  await page.route("**/api/cart/items/cali_CIMOBILE", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue()
      return
    }

    cartItems = []
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartResponse()),
    })
  })
  await page.route("**/api/cart/items", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }

    cartItems = [cartItem]
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartResponse()),
    })
  })

  await page.goto("/", { waitUntil: "domcontentloaded" })
  await rejectNonEssentialCookies(page)

  await page.getByRole("button", { name: "Open cart" }).click()
  const drawer = page.getByRole("dialog", { name: "Shopping cart" })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByText("Pathologist", { exact: true })).toBeVisible()
  await expect(drawer.getByText("Only 3 available")).toBeVisible()
  await expect(drawer.getByText("Current total")).toBeVisible()
  await expect(drawer.getByText("Calculated at checkout")).toHaveCount(2)
  await expect(drawer.getByRole("button", { name: "Checkout" })).toBeEnabled()
  await expectVisibleInteractivePointers(page)

  const viewportWidth =
    page.viewportSize()?.width ?? (await page.evaluate(() => window.innerWidth))
  await expect
    .poll(
      () => drawer.evaluate((dialog) => dialog.getBoundingClientRect().right),
      {
        message: "drawer opening animation should settle inside the viewport",
      }
    )
    .toBeLessThanOrEqual(viewportWidth)

  const layout = await drawer.evaluate((dialog) => {
    const checkout = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent?.trim() === "Checkout")
    const bounds = dialog.getBoundingClientRect()
    const checkoutBounds = checkout?.getBoundingClientRect()
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      drawerLeft: bounds.left,
      drawerRight: bounds.right,
      drawerWidth: bounds.width,
      checkoutBottom: checkoutBounds?.bottom ?? Number.POSITIVE_INFINITY,
      controls,
    }
  })

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.drawerLeft).toBeGreaterThanOrEqual(0)
  expect(layout.drawerRight).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.drawerWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.checkoutBottom).toBeLessThanOrEqual(layout.viewportHeight)
  expect(layout.controls.length).toBeGreaterThan(0)
  for (const control of layout.controls) {
    expect(control.width).toBeGreaterThanOrEqual(24)
    expect(control.height).toBeGreaterThanOrEqual(24)
  }

  const deviceName = testInfo.project.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
  await page.screenshot({
    path: `/tmp/remorseless-cart-drawer-${deviceName}.png`,
  })

  await drawer
    .getByRole("button", { name: "Remove Pathological Decomposition" })
    .click()
  await expect(drawer.getByText("Your cart is empty")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Undo", exact: true })
  ).toHaveCount(0)
  await expect(drawer.getByRole("button", { name: "Checkout" })).toHaveCount(0)
  await page.screenshot({
    path: `/tmp/remorseless-cart-empty-${deviceName}.png`,
  })
})

test("adding from quick shop confirms in place without opening the cart", async ({
  page,
}, testInfo) => {
  let activeCart: Record<string, unknown> | null = null
  const cartItem = {
    id: "cali_CIADDED",
    title: "Pathological Decomposition",
    product_title: "Pathological Decomposition",
    product_handle: "music-release-pathologist-pathological-decomposition",
    variant_id: "variant_CIPATHOLOGISTCD",
    variant_title: "CD",
    quantity: 1,
    unit_price: 15,
    subtotal: 15,
    total: 15,
    thumbnail: null,
    variant: {
      id: "variant_CIPATHOLOGISTCD",
      title: "CD",
      manage_inventory: true,
      allow_backorder: false,
      inventory_quantity: 10,
    },
    product: {
      id: "prod_CIPATHOLOGIST",
      handle: "music-release-pathologist-pathological-decomposition",
    },
  }

  await page.route("**/api/catalog/filters/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const fixture = catalogFilterFixtures[pathname]
    if (!fixture) {
      await route.fallback()
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
      body: JSON.stringify({ product: productDetailFixture }),
    })
  })
  await page.route("**/api/cart", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartEnvelopeFrom({ cart: activeCart })),
    })
  })
  await page.route("**/api/cart/items", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    activeCart = {
      id: "cart_CIADDED",
      currency_code: "usd",
      subtotal: 15,
      total: 15,
      items: [cartItem],
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartEnvelopeFrom({ cart: activeCart })),
    })
  })

  await page.goto("/catalog", { waitUntil: "domcontentloaded" })
  await rejectNonEssentialCookies(page)

  const search = page.getByRole("searchbox", {
    name: "Search catalog by product or artist name",
  })
  await search.fill("Pathologist")
  await expect(page.getByText("Showing 1 of 1")).toBeVisible()
  const quickShopButton = page
    .getByRole("region", { name: "Catalog results" })
    .getByRole("button", {
      name: "Quick shop Pathological Decomposition",
    })
  await expect(quickShopButton).toHaveCount(1)
  await quickShopButton.click()
  const quickShop = page.getByRole("dialog", { name: "Quick shop" })
  await expect(quickShop).toBeVisible()
  await quickShop.getByRole("button", { name: "Add to cart" }).click()

  const addedButton = quickShop.getByRole("button", { name: "Added" })
  await expect(addedButton).toBeVisible()
  await expect(quickShop.getByRole("status")).toContainText(
    "Pathological Decomposition added to cart."
  )
  await expect(quickShop).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Shopping cart" })).toHaveCount(
    0
  )
  await expect(
    page.locator('header button[aria-label="Open cart, 1 item"]')
  ).toHaveCount(1)
  const checkoutLink = quickShop.getByRole("link", { name: "Checkout" })
  await expect(checkoutLink).toBeVisible()
  await expect(checkoutLink).toHaveAttribute("href", "/checkout")

  await checkoutLink.scrollIntoViewIfNeeded()
  const deviceName = testInfo.project.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
  await page.screenshot({
    path: `/tmp/remorseless-cart-added-${deviceName}.png`,
  })
})

test("music release detail exposes a purchasable catalog record", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await rejectNonEssentialCookies(page)
  const quickShop = page
    .getByRole("button", { name: /^Quick shop / })
    .filter({ visible: true })
    .first()
  const accessibleName = await quickShop.getAttribute("aria-label")
  const productName = accessibleName?.replace(/^Quick shop /, "")
  const productPath = await quickShop
    .locator("xpath=ancestor::a[1]")
    .getAttribute("href")
  expect(productName).toBeTruthy()
  expect(productPath).toMatch(/^\/(?:bundle|merch|music-release)\//)

  const response = await page.goto(productPath!, {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  await expect(
    page.getByRole("heading", {
      name: productName!,
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible()
  await expectVisibleInteractivePointers(page)
  await expectVisibleInteractiveTargets(page)
})

test("catalog filters stay stable and combine predictably", async ({
  page,
}) => {
  const searchRequests: ProductSearchRequest[] = []
  await page.route("**/api/catalog/filters/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const fixture = catalogFilterFixtures[pathname]
    if (!fixture) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    })
  })
  await page.route("**/api/search/products", async (route) => {
    searchRequests.push(route.request().postDataJSON() as ProductSearchRequest)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(catalogSearchFixture),
    })
  })

  const response = await page.goto("/catalog", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  await rejectNonEssentialCookies(page)

  const filterTrigger = page.getByRole("button", { name: /^Show filters/ })
  const filterTriggerBounds = await filterTrigger.boundingBox()
  expect(filterTriggerBounds?.width).toBeGreaterThanOrEqual(44)
  expect(filterTriggerBounds?.height).toBeGreaterThanOrEqual(44)
  const sortTrigger = page.getByRole("combobox", { name: "Sort products" })
  const sortTriggerBounds = await sortTrigger.boundingBox()
  expect(sortTriggerBounds?.width).toBeGreaterThanOrEqual(44)
  expect(sortTriggerBounds?.height).toBeGreaterThanOrEqual(44)

  await filterTrigger.click()
  const drawer = page.getByRole("dialog", { name: "Filters" })
  await expect(drawer).toBeVisible()

  const inStockCheckbox = drawer.getByRole("checkbox", { name: "In stock" })
  await expect(inStockCheckbox).not.toBeChecked()
  await drawer.getByText("In stock", { exact: true }).click()
  await expect(inStockCheckbox).toBeChecked()
  await drawer.getByText("In stock", { exact: true }).click()
  await expect(inStockCheckbox).not.toBeChecked()

  const merchandise = drawer.getByRole("checkbox", {
    name: /^Merchandise/,
  })
  await expect(merchandise).toBeVisible()
  await drawer.getByText("Merchandise", { exact: true }).click()
  await expect(merchandise).toBeChecked()

  for (const productType of [
    "Music Releases",
    "Fixed Bundles",
    "Mystery Bundles",
  ]) {
    await expect(
      drawer.getByRole("checkbox", { name: new RegExp(`^${productType}`) })
    ).toBeVisible()
  }

  await drawer.getByRole("button", { name: "Genres" }).click()
  const deathMetal = drawer.getByRole("checkbox", { name: /^Death Metal/ })
  const grind = drawer.getByRole("checkbox", { name: /^Grind/ })
  await drawer.getByText("Death Metal", { exact: true }).click()
  await drawer.getByText("Grind", { exact: true }).click()
  await expect(deathMetal).toBeChecked()
  await expect(grind).toBeChecked()

  await drawer.getByRole("button", { name: "Formats" }).click()
  await expect(drawer.getByRole("checkbox", { name: /^DVD/ })).toBeVisible()
  await drawer.getByText("Merchandise", { exact: true }).click()
  await drawer.getByText("Music Releases", { exact: true }).click()
  await drawer.getByText("CD", { exact: true }).click()

  await drawer.getByRole("button", { name: "Price" }).click()
  const minimumPriceSlider = drawer.getByRole("slider", {
    name: "Minimum price",
  })
  const maximumPriceSlider = drawer.getByRole("slider", {
    name: "Maximum price",
  })
  await expect(minimumPriceSlider).toHaveAttribute("aria-valuenow", "1")
  await expect(maximumPriceSlider).toHaveAttribute("aria-valuenow", "56")
  const maximumPriceInput = drawer.getByRole("spinbutton", {
    name: "Maximum price in dollars",
  })
  await maximumPriceSlider.focus()
  await maximumPriceSlider.press("ArrowLeft")
  await expect(maximumPriceInput).toHaveValue("55")
  await maximumPriceInput.fill("20")
  await expect(maximumPriceSlider).toHaveAttribute("aria-valuenow", "20")
  await expect(drawer.getByRole("button", { name: "Apply" })).toHaveClass(
    /bg-destructive/
  )
  await expect(drawer.getByRole("button", { name: "Clear" })).toHaveClass(
    /border-destructive\/70/
  )
  await expectVisibleInteractivePointers(page)
  await drawer.getByRole("button", { name: "Apply" }).click()
  await expect(
    drawer.getByRole("button", { name: /Show [1-9]\d* results/ })
  ).toBeVisible()

  await expect(page).toHaveURL(/type=music-release/)
  await expect(page).toHaveURL(/genre=death-metal%2Cgrind/)
  await expect(page).toHaveURL(/format=CD/)
  await expect(page).toHaveURL(/maxPrice=20/)
  await expect
    .poll(() =>
      searchRequests.some(
        (request) =>
          request.filters?.genres?.includes("Death Metal") &&
          request.filters.genres.includes("Grind") &&
          request.filters.formats?.includes("CD") &&
          request.filters.productTypes?.includes("music-release") &&
          request.filters.price?.max === 20
      )
    )
    .toBe(true)

  const metrics = await page.evaluate(() => {
    const dialog = document
      .querySelector<HTMLElement>('[role="dialog"]')
      ?.getBoundingClientRect()
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      dialogLeft: dialog?.left ?? Number.NEGATIVE_INFINITY,
      dialogRight: dialog?.right ?? Number.POSITIVE_INFINITY,
    }
  })
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.dialogLeft).toBeGreaterThanOrEqual(0)
  expect(metrics.dialogRight).toBeLessThanOrEqual(metrics.viewportWidth)

  await drawer.getByRole("button", { name: /Show [1-9]\d* results/ }).click()
  const search = page.getByRole("searchbox", {
    name: "Search catalog by product or artist name",
  })
  await search.fill("Pathologist")
  const clearSearch = page.getByRole("button", {
    name: "Clear catalog search",
  })
  await expect(clearSearch).toBeVisible()
  const clearBounds = await clearSearch.boundingBox()
  expect(clearBounds?.width).toBeGreaterThanOrEqual(44)
  expect(clearBounds?.height).toBeGreaterThanOrEqual(44)
  await clearSearch.click()
  await expect(search).toHaveValue("")

  await sortTrigger.click()
  await page.getByRole("option", { name: /Artist · A → Z/ }).click()
  await expect.poll(() => searchRequests.at(-1)?.sort).toBe("artist-asc")
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe("artist-asc")
})

test("desktop filters preserve position while results refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route("**/api/catalog/filters/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const fixture = catalogFilterFixtures[pathname]
    if (!fixture) {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    })
  })
  await page.route("**/api/search/products", async (route) => {
    const request = route.request().postDataJSON() as ProductSearchRequest
    if (request.filters?.productTypes?.includes("music-release")) {
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createPaginationFixture(0, request.limit)),
    })
  })

  await page.goto("/catalog", { waitUntil: "domcontentloaded" })
  await rejectNonEssentialCookies(page)

  const sidebar = page.getByTestId("catalog-desktop-filters")
  await expect(sidebar).toBeVisible()
  await page.getByRole("button", { name: /^Hide filters/ }).click()
  await expect(sidebar).toBeHidden()
  await page.getByRole("button", { name: /^Show filters/ }).click()
  await expect(sidebar).toBeVisible()
  await page.evaluate(() => window.scrollTo({ top: 600 }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)

  const readLayout = () =>
    page.evaluate(() => {
      const filters = document.querySelector<HTMLElement>(
        '[data-testid="catalog-desktop-filters"]'
      )
      return {
        documentHeight: document.documentElement.scrollHeight,
        sidebarTop: filters?.getBoundingClientRect().top ?? null,
        viewportHeight: window.innerHeight,
        windowScrollY: window.scrollY,
      }
    })

  const before = await readLayout()
  const musicReleases = page.getByRole("checkbox", {
    name: /^Music Releases/,
  })
  await page.getByText("Music Releases", { exact: true }).click()
  await expect(musicReleases).toBeChecked()
  await expect(page.getByText("Refreshing…", { exact: true })).toBeVisible()

  const during = await readLayout()
  expect(during.windowScrollY).toBe(before.windowScrollY)
  expect(during.sidebarTop).toBe(before.sidebarTop)
  expect(during.documentHeight).toBeGreaterThanOrEqual(
    during.windowScrollY + during.viewportHeight
  )

  await expect(page.getByText("Refreshing…", { exact: true })).toBeHidden()
  const after = await readLayout()
  expect(after.windowScrollY).toBe(before.windowScrollY)
  expect(after.sidebarTop).toBe(before.sidebarTop)
  expect(after.documentHeight).toBeGreaterThanOrEqual(
    after.windowScrollY + after.viewportHeight
  )
})

test("catalog loads the next result window before the end is reached", async ({
  page,
}) => {
  const searchRequests: ProductSearchRequest[] = []

  await page.route("**/api/search/products", async (route) => {
    const request = route.request().postDataJSON() as ProductSearchRequest
    searchRequests.push(request)

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        createPaginationFixture(request.offset ?? 0, request.limit ?? 60)
      ),
    })
  })

  const response = await page.goto("/catalog", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  await rejectNonEssentialCookies(page)

  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0)

  const loadedCount = page.getByText("Showing 60 of 461")
  await loadedCount.scrollIntoViewIfNeeded()

  await expect
    .poll(() => searchRequests.some((request) => request.offset === 60))
    .toBe(true)
  await expect(page.getByText("Showing 120 of 461")).toBeVisible()
})

const routes = [
  "/",
  "/catalog",
  "/discography",
  "/news",
  "/contact",
  "/about",
  "/submissions",
  "/faq",
  "/help/shipping",
  "/shipping",
  "/returns",
  "/terms",
  "/privacy",
  "/accessibility",
  "/cookies",
  "/cart",
] as const

for (const path of routes) {
  test(`${path} stays within the emulated mobile viewport`, async ({
    page,
  }) => {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" })
    expect(response?.status()).toBeLessThan(400)

    await expect(page.getByRole("banner")).toBeVisible()
    await expect(page.locator("main").first()).toBeVisible()

    const metrics = await page.evaluate(() => {
      const header = document.querySelector("header")?.getBoundingClientRect()
      const main = document.querySelector("main")?.getBoundingClientRect()

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        headerRight: header?.right ?? Number.POSITIVE_INFINITY,
        mainRight: main?.right ?? Number.POSITIVE_INFINITY,
        touchPoints: navigator.maxTouchPoints,
        mobileUserAgent: /mobile|iphone/i.test(navigator.userAgent),
      }
    })

    expect(metrics.mobileUserAgent).toBe(true)
    expect(metrics.touchPoints).toBeGreaterThan(0)
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.headerRight).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.mainRight).toBeLessThanOrEqual(metrics.viewportWidth)
  })
}

test("discography header precedes every desktop row", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("Desktop"))

  const response = await page.goto("/discography", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  const activeMain = page.getByRole("main")
  const header = activeMain.getByTestId("discography-table-header")
  const firstRow = activeMain.getByTestId("discography-row").first()
  await expect(header).toBeVisible()
  await expect(firstRow).toBeVisible()

  const headerBounds = await header.boundingBox()
  const rowBounds = await firstRow.boundingBox()
  expect(headerBounds).not.toBeNull()
  expect(rowBounds).not.toBeNull()
  expect(headerBounds!.y + headerBounds!.height).toBeLessThanOrEqual(
    rowBounds!.y + 1
  )
})

test("checkout remains accessible and contained with device emulation", async ({
  page,
}, testInfo) => {
  const revisions = {
    contact: `v1.${"b".repeat(43)}`,
    delivery: `v1.${"c".repeat(43)}`,
    initial: `v1.${"a".repeat(43)}`,
    shipping: `v1.${"d".repeat(43)}`,
  }
  let checkoutStep: "contact" | "delivery" | "initial" | "shipping" = "initial"
  let checkoutQuantity = 1

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
  const checkout = () => {
    const hasContact = checkoutStep !== "initial"
    const hasDelivery =
      checkoutStep === "delivery" || checkoutStep === "shipping"
    const hasShipping = checkoutStep === "shipping"
    return {
      state: !hasContact
        ? "needs_contact"
        : !hasDelivery
          ? "needs_address"
          : !hasShipping
            ? "needs_shipping"
            : "ready_for_payment",
      revision: revisions[checkoutStep],
      cart: {
        items: [
          {
            id: "cali_CHECKOUTMOBILE",
            productHandle:
              "music-release-pathologist-pathological-decomposition",
            productTitle: "Pathological Decomposition",
            availableQuantity: 5,
            quantity: checkoutQuantity,
            subtotal: 20 * checkoutQuantity,
            thumbnail: null,
            unitPrice: 20,
            variantTitle: "LP",
          },
        ],
        totals: {
          taxCollectionMode: "collect",
          currencyCode: "usd",
          subtotal: 20 * checkoutQuantity,
          discountTotal: 0,
          shippingTotal: hasShipping ? 5 : 0,
          taxTotal: hasShipping ? 1.5 : 0,
          total: 20 * checkoutQuantity + (hasShipping ? 5 + 1.5 : 0),
        },
        contact: hasContact ? { email: "buyer@example.test" } : null,
        deliveryAddress: hasDelivery ? address : null,
        shippingMethod: hasShipping
          ? {
              id: "casm_standard",
              name: "Standard",
              optionId: "so_standard",
              amount: 5,
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
    }
  }

  const cart = () => ({
    id: "cart_CHECKOUTMOBILE",
    currency_code: "usd",
    subtotal: 20 * checkoutQuantity,
    total: 20 * checkoutQuantity,
    items: [
      {
        id: "cali_CHECKOUTMOBILE",
        title: "Pathological Decomposition",
        product_title: "Pathological Decomposition",
        product_handle: "music-release-pathologist-pathological-decomposition",
        variant_id: "variant_CHECKOUTMOBILE",
        variant_title: "LP",
        quantity: checkoutQuantity,
        unit_price: 20,
        subtotal: 20 * checkoutQuantity,
        total: 20 * checkoutQuantity,
        thumbnail: null,
        variant: {
          id: "variant_CHECKOUTMOBILE",
          title: "LP",
          manage_inventory: true,
          allow_backorder: false,
          inventory_quantity: 5,
        },
        product: {
          id: "prod_CHECKOUTMOBILE",
          handle: "music-release-pathologist-pathological-decomposition",
        },
      },
    ],
  })

  await page.route("**/api/cart", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cartEnvelopeFrom({ cart: cart() })),
    })
  })
  await page.route("**/api/cart/items/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { quantity: number }
      checkoutQuantity = body.quantity
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cartEnvelopeFrom({ cart: cart() })),
      })
      return
    }

    await route.fulfill({
      status: 405,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unexpected cart item request" }),
    })
  })
  await page.route("**/api/checkout{,/**}", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const method = request.method()

    if (pathname === "/api/checkout" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout: checkout() }),
      })
      return
    }
    if (pathname === "/api/checkout/contact" && method === "PUT") {
      checkoutStep = "contact"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout: checkout() }),
      })
      return
    }
    if (pathname === "/api/checkout/delivery-address" && method === "PUT") {
      checkoutStep = "delivery"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout: checkout() }),
      })
      return
    }
    if (pathname === "/api/checkout/shipping-options" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shippingOptions: [
            {
              id: "so_standard",
              name: "Standard",
              description: "Tracked delivery",
              amount: 5,
              currencyCode: "usd",
              insufficientInventory: false,
            },
            {
              id: "so_express",
              name: "Express",
              description: "Faster tracked delivery",
              amount: 12,
              currencyCode: "usd",
              insufficientInventory: false,
            },
          ],
        }),
      })
      return
    }
    if (pathname === "/api/checkout/shipping-method" && method === "PUT") {
      checkoutStep = "shipping"
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkout: checkout() }),
      })
      return
    }
    if (pathname === "/api/checkout/payment-session" && method === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://remorselessrecords.com/problems/payment-not-configured",
          title: "Payment is temporarily unavailable",
          status: 503,
          detail: "Secure payment could not be prepared. Try again.",
          code: "payment_not_configured",
          instance: pathname,
        }),
      })
      return
    }

    await route.fulfill({ status: 404, body: "Unexpected checkout request" })
  })

  const response = await page.goto("/checkout", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  await rejectNonEssentialCookies(page)

  await expect(
    page.getByRole("heading", { name: "Finish your order" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue to delivery" }).click()
  await expect(page.getByLabel("Email address")).toBeFocused()
  await page.getByLabel("Email address").fill("buyer@example.test")
  await page.getByRole("button", { name: "Continue to delivery" }).click()

  await page
    .getByRole("button", { name: "Continue to delivery method" })
    .click()
  const addressErrors = page.getByRole("alert", {
    name: "Check your delivery address",
  })
  await expect(addressErrors).toBeFocused()
  await expect(
    addressErrors.getByRole("button", { name: /ZIP code:/ })
  ).toBeVisible()

  await page.getByLabel("First name").fill("Ada")
  await page.getByLabel("Last name").fill("Lovelace")
  await page.getByLabel("Street address").fill("123 Test Street")
  await page.getByLabel("City").fill("Phoenix")
  await page.getByRole("combobox", { name: "State" }).click()
  await page.getByRole("option", { name: "Arizona" }).click()
  await page.getByLabel("ZIP code").fill("85001")
  await page
    .getByRole("button", { name: "Continue to delivery method" })
    .click()

  await page.getByRole("radio", { name: /Standard/ }).click()
  await page.getByRole("button", { name: "Continue to payment" }).click()
  await expect(
    page.getByText("Secure payment could not be prepared. Try again.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Edit contact" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Edit delivery address" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Edit delivery method" })
  ).toBeVisible()

  const showSummary = page.getByRole("button", {
    name: "Show order summary",
  })
  if (await showSummary.isVisible()) {
    await showSummary.click()
  }
  await page
    .getByRole("button", {
      name: "Increase quantity of Pathological Decomposition",
    })
    .click()
  await expect(
    page.getByRole("button", {
      name: "Decrease quantity of Pathological Decomposition",
    })
  ).toBeEnabled()
  await expect(
    page.getByRole("definition").filter({ hasText: "$46.50" })
  ).toBeVisible()
  await expect(page).toHaveURL(/\/checkout$/)
  await expect(page.getByRole("link", { name: "Edit cart" })).toHaveCount(0)

  await expectVisibleInteractivePointers(page)
  const layout = await page.evaluate(() => {
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      touchPoints: navigator.maxTouchPoints,
    }
  })

  if (testInfo.project.name.startsWith("Desktop")) {
    expect(layout.touchPoints).toBe(0)
  } else {
    expect(layout.touchPoints).toBeGreaterThan(0)
  }
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth)
  await expectVisibleInteractiveTargets(page)

  const deviceName = testInfo.project.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
  await page.screenshot({
    path: `/tmp/remorseless-checkout-${deviceName}.png`,
    fullPage: true,
  })
})

test("checkout remains accessible after confirmation", async ({
  page,
}, testInfo) => {
  await page.route("**/api/checkout/confirmation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        receipt: {
          orderNumber: "1042",
          placedAt: "2026-07-25T16:30:00.000Z",
          email: "buyer@example.test",
          items: [
            {
              id: "item_checkout_confirmation",
              title: "Pathological Decomposition",
              variantTitle: "LP",
              thumbnail: null,
              quantity: 1,
              total: 20,
            },
          ],
          deliveryAddress: {
            firstName: "Ada",
            lastName: "Lovelace",
            address1: "123 Test Street",
            address2: null,
            city: "Phoenix",
            province: "AZ",
            postalCode: "85001",
            countryCode: "US",
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

  const response = await page.goto("/checkout/confirmation", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBeLessThan(400)

  await rejectNonEssentialCookies(page)

  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible()
  await expect(page.getByText("Order #1042", { exact: false })).toBeVisible()
  await expect(page.getByText("$26.50", { exact: true })).toBeVisible()
  await expectVisibleInteractivePointers(page)
  await expectVisibleInteractiveTargets(page)

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth)

  const deviceName = testInfo.project.name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
  await page.screenshot({
    path: `/tmp/remorseless-checkout-confirmation-${deviceName}.png`,
    fullPage: true,
  })
})
