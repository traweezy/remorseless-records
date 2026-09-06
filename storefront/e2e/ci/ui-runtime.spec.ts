import { readFile } from "node:fs/promises"
import { expect, test, type Locator } from "@playwright/test"

import { cartEnvelopeFrom } from "@/lib/cart/snapshot"
import {
  buildCookiePreferences,
  COOKIE_PREFERENCES_COOKIE_NAME,
  COOKIE_PREFERENCES_STORAGE_KEY,
  serializeCookiePreferences,
} from "@/lib/legal/cookie-consent"
import type { ProductSearchResponse } from "@/lib/search/search"

const galleryTitle = "Gallery Runtime Pressing"
const galleryImagePaths = {
  front: "/remorseless-hero-logo.png",
  back: "/remorseless-header-logo.png",
  insert: "/favicon.ico",
} as const
const quickShopHandle = "music-release-ci-quick-shop-runtime"
const quickShopTitle = "Quick Shop Runtime Pressing"
const quickShopProduct = {
  id: "prod_CIQUICKSHOPRUNTIME",
  handle: quickShopHandle,
  title: quickShopTitle,
  description: "A delayed local release for drawer lifecycle acceptance.",
  images: [],
  variants: [
    {
      id: "variant_CIQUICKSHOPRUNTIME",
      title: "CD",
      calculated_price: { calculated_amount: 15, currency_code: "usd" },
      inventory_quantity: 10,
      manage_inventory: true,
      allow_backorder: false,
      metadata: { inventory_count_status: "verified" },
    },
  ],
}
const quickShopSearch: ProductSearchResponse = {
  hits: [
    {
      id: quickShopProduct.id,
      handle: quickShopHandle,
      title: quickShopTitle,
      artist: "CI Artist",
      album: quickShopTitle,
      subtitle: null,
      thumbnail: null,
      collectionTitle: null,
      slug: {
        artist: "CI Artist",
        album: quickShopTitle,
        artistSlug: "ci-artist",
        albumSlug: "quick-shop-runtime-pressing",
      },
      defaultVariant: {
        id: "variant_CIQUICKSHOPRUNTIME",
        title: "CD",
        currency: "usd",
        amount: 15,
        hasPrice: true,
        inStock: true,
        stockStatus: "in_stock",
        inventoryQuantity: 10,
      },
      formats: ["CD"],
      genres: [],
      metalGenres: [],
      categories: [],
      categoryHandles: [],
      variantTitles: ["CD"],
      artistNames: ["CI Artist"],
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
  facets: {},
  hasMore: false,
  nextOffset: 1,
}

const expectDecorativeIcons = async (control: Locator): Promise<void> => {
  const icons = control.locator("svg")
  expect(await icons.count()).toBeGreaterThan(0)
  for (const icon of await icons.all()) {
    await expect(icon).toHaveAttribute("aria-hidden", "true")
  }
  await expect(control.getByRole("img")).toHaveCount(0)
}

test.beforeEach(async ({ page, context, baseURL }) => {
  const preferences = buildCookiePreferences(
    { analytics: false, marketing: false },
    new Date("2026-09-06T00:00:00.000Z")
  )
  await context.addCookies([
    {
      name: COOKIE_PREFERENCES_COOKIE_NAME,
      value: serializeCookiePreferences(preferences),
      url: baseURL,
    },
  ])
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: COOKIE_PREFERENCES_STORAGE_KEY,
      value: JSON.stringify(preferences),
    }
  )
  await page.route("**/api/cart", (route) =>
    route.fulfill({ json: cartEnvelopeFrom({ cart: null }) })
  )
})

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`UI runtime gallery handles rapid navigation and image failure (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    // The dedicated handle exists only in the local provider fixture.
    test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Local gallery fixture")
    await page.emulateMedia({ reducedMotion })
    const [frontArtwork, backArtwork] = await Promise.all([
      readFile("public/remorseless-hero-logo.png"),
      readFile("public/remorseless-header-logo.png"),
    ])
    const failedImage = Promise.withResolvers<void>()
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.route("**/_next/image?**", async (route) => {
      const source = new URL(route.request().url()).searchParams.get("url")
      if (!Object.values(galleryImagePaths).some((path) => path === source)) {
        await route.fallback()
        return
      }
      if (source === galleryImagePaths.insert) {
        await failedImage.promise
        await route.abort("failed")
        return
      }
      await route.fulfill({
        contentType: "image/png",
        body: source === galleryImagePaths.front ? frontArtwork : backArtwork,
      })
    })
    try {
      await page.goto("/music-release/ci-gallery-artwork", {
        waitUntil: "domcontentloaded",
      })
      const mainImage = page.locator(
        `img[alt="${galleryTitle}"]:not(button img)`
      )
      const expectMainImage = async (
        view: keyof typeof galleryImagePaths
      ): Promise<void> => {
        await expect(mainImage).toHaveCount(1)
        await expect
          .poll(() => mainImage.getAttribute("src"))
          .toContain(encodeURIComponent(galleryImagePaths[view]))
        await expect(mainImage).toHaveJSProperty("complete", true)
        await expect
          .poll(() =>
            mainImage.evaluate((image: HTMLImageElement) => image.naturalWidth)
          )
          .toBeGreaterThan(0)
        await expect(mainImage.locator("..")).toHaveCSS("opacity", "1")
      }
      const previous = page.getByRole("button", { name: "Previous image" })
      const next = page.getByRole("button", { name: "Next image" })
      await expectMainImage("front")
      await expect(previous).toBeDisabled()
      await expectDecorativeIcons(next)
      await next.press("Enter")
      await previous.press("Enter")
      await next.press("Enter")
      await expectMainImage("back")
      await page
        .getByRole("button", { name: "View image 1 of 3" })
        .press("Enter")
      await expectMainImage("front")
      await page
        .getByRole("button", { name: "View image 3 of 3" })
        .press("Enter")
      await expect(next).toBeDisabled()
      await expect
        .poll(() => mainImage.getAttribute("src"))
        .toContain(encodeURIComponent(galleryImagePaths.insert))
      failedImage.resolve()
      await expect(
        page.getByRole("button", { name: /View image \d of 2/ })
      ).toHaveCount(2)
      await expectMainImage("back")
      await expect(next).toBeDisabled()
      await previous.press("Enter")
      await expectMainImage("front")
      await expect(previous).toBeDisabled()
      await expect(next).toBeEnabled()
      await expect(
        page.getByText("Artwork unavailable", { exact: true })
      ).toHaveCount(0)
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" })
      )
      await page.screenshot({
        path: testInfo.outputPath("gallery-recovered.png"),
        fullPage: true,
      })
      expect(pageErrors).toEqual([])
    } finally {
      failedImage.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
  })

  test(`UI runtime quick shop preserves loading, reopen, and focus (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const productReady = Promise.withResolvers<void>()
    let detailRequests = 0
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.route("**/api/search/products", (route) =>
      route.fulfill({ json: quickShopSearch })
    )
    await page.route(`**/api/products/${quickShopHandle}`, async (route) => {
      detailRequests += 1
      await productReady.promise
      await route.fulfill({ json: { product: quickShopProduct } })
    })
    try {
      // The cart provider reads after client mount. Waiting for that response
      // avoids typing into SSR markup before React attaches input handlers.
      const hydrated = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/cart" &&
          response.request().method() === "GET"
      )
      await page.goto("/catalog", { waitUntil: "domcontentloaded" })
      await hydrated
      await page.waitForLoadState("load")
      await page
        .getByRole("searchbox", {
          name: "Search catalog by product or artist name",
        })
        .fill("runtime")
      const trigger = page.getByRole("button", {
        name: `Quick shop ${quickShopTitle}`,
      })
      await expect(trigger).toBeVisible()
      await expectDecorativeIcons(trigger)
      await trigger.press("Enter")
      const drawer = page.getByRole("dialog", { name: "Quick shop" })
      await expect(
        drawer.getByRole("heading", { name: "Loading release" })
      ).toBeVisible()
      const skeletons = drawer.locator(".skeleton")
      await expect(skeletons).toHaveCount(3)
      await expect(skeletons.first().locator("..")).toHaveCSS("opacity", "1")
      if (reducedMotion === "reduce") {
        await expect(skeletons.first()).toHaveCSS("animation-name", "none")
      }
      await page.screenshot({
        path: testInfo.outputPath("quick-shop-loading.png"),
      })
      await drawer.getByRole("button", { name: "Close quick shop" }).click()
      await expect(drawer).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("Enter")
      await expect(
        drawer.getByRole("heading", { name: "Loading release" })
      ).toBeVisible()
      await expect(skeletons).toHaveCount(3)
      productReady.resolve()
      await expect(
        drawer.getByRole("heading", { name: quickShopTitle })
      ).toBeVisible()
      await expect(skeletons).toHaveCount(0)
      await expect(
        drawer.getByRole("button", { name: "Add to cart" })
      ).toBeEnabled()
      await expect(drawer.getByText(quickShopProduct.description)).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("Enter")
      await expect(
        drawer.getByRole("heading", { name: quickShopTitle })
      ).toBeVisible()
      await expect(skeletons).toHaveCount(0)
      expect(detailRequests).toBe(1)
      expect(pageErrors).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath("quick-shop-reopened.png"),
      })
    } finally {
      productReady.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
  })
}

test("UI runtime cart and calendar icons retain accessible controls", async ({
  page,
}, testInfo) => {
  await page.goto("/discography", { waitUntil: "domcontentloaded" })
  const cart = page.getByRole("button", {
    name: "Open cart, empty",
    exact: true,
  })
  await expectDecorativeIcons(cart)
  await cart.press("Enter")
  await expect(
    page.getByRole("dialog", { name: "Shopping cart" })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(cart).toBeFocused()
  const sort = page.getByRole("combobox", { name: "Sort discography" })
  await sort.press("Enter")
  const newest = page.getByRole("option", { name: "Newest", exact: true })
  const oldest = page.getByRole("option", { name: "Oldest", exact: true })
  await expectDecorativeIcons(newest)
  await expectDecorativeIcons(oldest)
  await page.screenshot({ path: testInfo.outputPath("calendar-icons.png") })
  await oldest.press("Enter")
  await expect(sort).toBeFocused()
  await expect(sort).toContainText("Oldest")
  await expectDecorativeIcons(sort)
  await sort.press("Enter")
  await newest.press("Enter")
  await expect(sort).toBeFocused()
  await expect(sort).toContainText("Newest")
})
