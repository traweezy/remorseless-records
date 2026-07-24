import { expect, test, type Page } from "@playwright/test"

import type {
  ProductSearchRequest,
  ProductSearchResponse,
} from "@/lib/search/search"

const catalogSearchFixture: ProductSearchResponse = {
  hits: [
    {
      id: "prod_ci_pathologist",
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
        id: "variant_ci_pathologist_cd",
        title: "CD",
        currency: "usd",
        amount: 1_500,
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
      priceAmount: 1_500,
      priceMin: 1_500,
      priceMax: 1_500,
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
    range: { min: 100, max: 5_600, currency: "usd" },
  },
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
      id: `prod_ci_pagination_${sequence}`,
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

test("homepage hydrates every curated shelf without client errors", async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const response = await page.goto("/", { waitUntil: "domcontentloaded" })
  expect(response?.status()).toBeLessThan(400)

  for (const heading of [
    "Featured Picks",
    "Newest Arrivals",
    "Staff Signals",
    "Latest News",
  ]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first()
    ).toBeVisible()
  }

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
    ).map((slide) => {
      const content = slide.querySelector<HTMLElement>(
        ".product-carousel__card > *"
      )
      return content?.getBoundingClientRect().left ?? Number.NEGATIVE_INFINITY
    }),
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
  await page.goto("/", { waitUntil: "networkidle" })
  await expectVisibleInteractivePointers(page)

  const rejectCookies = page.getByRole("button", {
    name: "Reject non-essential",
  })
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click()
  }

  const openNavigation = page.getByRole("button", {
    name: "Open navigation",
  })
  if (await openNavigation.isVisible()) {
    await openNavigation.click()
    await expectVisibleInteractivePointers(page)
    await page.getByRole("button", { name: "Close navigation" }).click()
  }

  await page.goto("/catalog", { waitUntil: "networkidle" })
  await expectVisibleInteractivePointers(page)
  await page.getByRole("combobox", { name: "Sort products" }).click()
  await expectVisibleInteractivePointers(page)
  await page.keyboard.press("Escape")

  await page.goto("/discography", { waitUntil: "networkidle" })
  await expectVisibleInteractivePointers(page)
  await page.getByRole("combobox", { name: "Availability" }).click()
  await expectVisibleInteractivePointers(page)
  await page.keyboard.press("Escape")

  await page.goto("/contact", { waitUntil: "networkidle" })
  await expectVisibleInteractivePointers(page)

  await page.goto("/cookies", { waitUntil: "networkidle" })
  await expectVisibleInteractivePointers(page)
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

  const response = await page.goto("/catalog", { waitUntil: "networkidle" })
  expect(response?.status()).toBeLessThan(400)

  const rejectCookies = page.getByRole("button", {
    name: "Reject non-essential",
  })
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click()
  }

  await page.getByRole("button", { name: /^Filters/ }).click()
  const drawer = page.getByRole("dialog", { name: "Filters" })
  await expect(drawer).toBeVisible()

  const inStockButton = drawer.getByRole("button", { name: "In stock" })
  await expect(inStockButton).toHaveAttribute("aria-pressed", "false")
  await expect(inStockButton).toHaveClass(/border-destructive\/70/)
  await inStockButton.click()
  await expect(inStockButton).toHaveAttribute("aria-pressed", "true")
  await expect(inStockButton).toHaveClass(/bg-destructive/)
  await inStockButton.click()

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
  await expect(minimumPriceSlider).toHaveAttribute("aria-valuenow", "100")
  await expect(maximumPriceSlider).toHaveAttribute("aria-valuenow", "5600")
  const maximumPriceInput = drawer.getByRole("spinbutton", {
    name: "Maximum price in dollars",
  })
  await maximumPriceSlider.focus()
  await maximumPriceSlider.press("ArrowLeft")
  await expect(maximumPriceInput).toHaveValue("55")
  await maximumPriceInput.fill("20")
  await expect(maximumPriceSlider).toHaveAttribute("aria-valuenow", "2000")
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
          request.filters.price?.max === 2_000
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

  await page.goto("/catalog", { waitUntil: "networkidle" })
  const rejectCookies = page.getByRole("button", {
    name: "Reject non-essential",
  })
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click()
  }

  const sidebar = page.getByTestId("catalog-desktop-filters")
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
    before.documentHeight * 0.95
  )

  await expect(page.getByText("Refreshing…", { exact: true })).toBeHidden()
  const after = await readLayout()
  expect(after.windowScrollY).toBe(before.windowScrollY)
  expect(after.sidebarTop).toBe(before.sidebarTop)
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

  const response = await page.goto("/catalog", { waitUntil: "networkidle" })
  expect(response?.status()).toBeLessThan(400)

  const rejectCookies = page.getByRole("button", {
    name: "Reject non-essential",
  })
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click()
  }

  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0)

  const loadedCount = page.getByText("Showing 60 of 461")
  await loadedCount.scrollIntoViewIfNeeded()

  await expect
    .poll(() => searchRequests.some((request) => request.offset === 60))
    .toBe(true)
  await expect(page.getByText("Showing 120 of 461")).toBeVisible()
})

const routes = ["/about", "/accessibility", "/cookies", "/terms"] as const

for (const path of routes) {
  test(`${path} stays within the emulated mobile viewport`, async ({
    page,
  }) => {
    const response = await page.goto(path, { waitUntil: "networkidle" })
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
