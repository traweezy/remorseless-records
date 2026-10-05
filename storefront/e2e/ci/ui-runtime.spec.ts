import { readFile } from "node:fs/promises"
import AxeBuilder from "@axe-core/playwright"
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"

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
  await expect(icons.first()).toBeAttached()
  expect(await icons.count()).toBeGreaterThan(0)
  for (const icon of await icons.all()) {
    await expect(icon).toHaveAttribute("aria-hidden", "true")
  }
  await expect(control.getByRole("img")).toHaveCount(0)
}

const expectDrawerAccessibility = async (
  page: Page,
  testInfo: TestInfo
): Promise<void> => {
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze()
  await testInfo.attach("drawer-accessibility", {
    body: JSON.stringify(accessibility, null, 2),
    contentType: "application/json",
  })
  expect(accessibility.violations).toEqual([])

  const selectors: string[] = []
  let reviewAllText = false
  for (const result of accessibility.incomplete) {
    expect(result.id).toBe("color-contrast")
    if (result.error) {
      // Firefox exposes scientific notation in the covered page's OKLab
      // colors. This axe parser error aborts the whole rule, so inspect every
      // visible dialog text node rather than only the first reported node.
      expect(result.error.message).toMatch(
        /^Unable to parse color "oklab\([^"\n]*e-[^"\n]*\)" Skipping color-contrast rule\.$/u
      )
      reviewAllText = true
      continue
    }
    for (const node of result.nodes) {
      expect(node.any).toHaveLength(1)
      expect(node.any[0]?.data?.messageKey).toBe("elmPartiallyObscuring")
      expect(node.target).toHaveLength(1)
      const selector = node.target[0]
      if (typeof selector !== "string") throw new Error("Unexpected axe target")
      selectors.push(selector)
    }
  }
  if (!reviewAllText && selectors.length === 0) return
  const reviews = await page.locator('[role="dialog"]').evaluate(
    (panel, { selectors, reviewAllText }) => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) throw new Error("Browser color conversion is unavailable")
      const rgba = (value: string): number[] => {
        if (!CSS.supports("color", value)) throw new Error("Unrecognized color")
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = value
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].map(
          (channel, index) => (index === 3 ? channel / 255 : channel)
        )
      }
      const composite = (front: number[], back: number[]): number[] => {
        const frontAlpha = front[3] ?? 0
        const backAlpha = back[3] ?? 0
        const alpha = frontAlpha + backAlpha * (1 - frontAlpha)
        return [0, 1, 2]
          .map((index) =>
            alpha === 0
              ? 0
              : ((front[index] ?? 0) * frontAlpha +
                  (back[index] ?? 0) * backAlpha * (1 - frontAlpha)) /
                alpha
          )
          .concat(alpha)
      }
      const luminance = (channels: number[]): number => {
        const linear = channels.map((channel) => {
          const value = channel / 255
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
        })
        return (
          0.2126 * (linear[0] ?? 0) +
          0.7152 * (linear[1] ?? 0) +
          0.0722 * (linear[2] ?? 0)
        )
      }
      const selected = selectors.map((selector) => {
        const element = document.querySelector(selector)
        if (!element || !panel.contains(element))
          throw new Error("Axe target left the dialog")
        return element
      })
      const elements = new Set<Element>(selected)
      if (reviewAllText) {
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          if (node.textContent?.trim() && node.parentElement)
            elements.add(node.parentElement)
        }
      }
      const reviewed = []
      for (const element of elements) {
        if (element.closest(':disabled, [aria-disabled="true"]')) continue
        let left = 0,
          top = 0,
          right = innerWidth,
          bottom = innerHeight
        let hidden = false
        for (
          let parent: Element | null = element;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent)
          if (
            style.visibility === "hidden" ||
            style.display === "none" ||
            style.clip !== "auto" ||
            style.clipPath !== "none"
          )
            hidden = true
          const box = parent.getBoundingClientRect()
          if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
            left = Math.max(left, box.left)
            right = Math.min(right, box.right)
          }
          if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
            top = Math.max(top, box.top)
            bottom = Math.min(bottom, box.bottom)
          }
        }
        const rects: DOMRect[] = []
        for (const child of element.childNodes) {
          if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim())
            continue
          const range = document.createRange()
          range.selectNodeContents(child)
          rects.push(...range.getClientRects())
        }
        const visible = rects.filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            Math.min(right, rect.right) > Math.max(left, rect.left) &&
            Math.min(bottom, rect.bottom) > Math.max(top, rect.top)
        )
        if (
          selected.includes(element) &&
          (hidden || visible.length !== rects.length || !rects.length)
        )
          throw new Error("Reported text is clipped or hidden")
        if (hidden || !visible.length) continue
        const style = getComputedStyle(element)
        let background = [0, 0, 0, 0]
        for (
          let parent: Element | null = element;
          parent;
          parent = parent.parentElement
        ) {
          const parentStyle = getComputedStyle(parent)
          if (
            parentStyle.opacity !== "1" ||
            parentStyle.backgroundImage !== "none" ||
            parentStyle.mixBlendMode !== "normal" ||
            parentStyle.filter !== "none"
          )
            throw new Error("Contrast review cannot resolve composited colors")
          background = composite(background, rgba(parentStyle.backgroundColor))
          if (background[3] === 1) break
          if (parent.matches('[role="dialog"]')) break
        }
        if (background[3] !== 1)
          throw new Error("Dialog has no opaque text background")
        const foregroundLuminance = luminance(
          composite(rgba(style.color), background)
        )
        const backgroundLuminance = luminance(background)
        const contrast =
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        const size = Number.parseFloat(style.fontSize)
        const large =
          size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
        const unobscured = visible.every((rect) => {
          const y =
            (Math.max(top, rect.top) + Math.min(bottom, rect.bottom)) / 2
          for (
            let x = Math.max(left, rect.left) + 1;
            x < Math.min(right, rect.right);
            x += 8
          ) {
            const topmost = document.elementFromPoint(x, y)
            if (topmost !== element && !element.contains(topmost)) return false
          }
          return true
        })
        reviewed.push({
          text: element.textContent?.trim(),
          foreground: style.color,
          background,
          contrast,
          minimum: large ? 3 : 4.5,
          unobscured,
        })
      }
      return reviewed
    },
    { selectors, reviewAllText }
  )
  await testInfo.attach("drawer-contrast-review", {
    body: JSON.stringify({ reviewAllText, reviews }, null, 2),
    contentType: "application/json",
  })
  expect(reviews.length).toBeGreaterThan(0)
  for (const review of reviews) {
    expect(review.contrast).toBeGreaterThanOrEqual(review.minimum)
    expect(review.unobscured).toBe(true)
  }
}

test("UI runtime authored merchandise resolves a bare handle and canonical artwork", async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Local canonical presentation fixture"
  )
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const response = await page.goto("/merch/ci-editor-shirt")
  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole("heading", { name: "Editor Authored Shirt", exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Canonical cotton shirt & original artwork.", {
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByText("Stale native description")).toHaveCount(0)
  await expect(
    page.getByRole("group", { name: "Available options", exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Explore more releases and merchandise.", { exact: true })
  ).toBeVisible()
  await expect(page.locator("strong", { hasText: "cotton" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Product details", exact: true })
  ).toBeVisible()
  await expect(page.getByText("Cold wash", { exact: true })).toBeVisible()
  await expect(
    page.getByText("S: 18 inches\nM: 20 inches", { exact: true })
  ).toBeVisible()
  const artwork = page
    .getByRole("img", { name: "Original landscape shirt artwork", exact: true })
    .first()
  await expect(artwork).toBeVisible()
  await expect(artwork).toHaveCSS("object-fit", "contain")
  await expect
    .poll(() =>
      artwork.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
      )
    )
    .toBe(true)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath("canonical-merchandise.png"),
    fullPage: true,
  })
  expect(errors).toEqual([])
  const detail = await page.request.get("/api/products/ci-editor-shirt")
  expect(detail.status()).toBe(200)
  const { product } = await detail.json()
  expect(product).toMatchObject({
    description: "Canonical cotton shirt & original artwork.",
    metadata: { product_type: "merch" },
    presentation: { managedMedia: true },
  })
  await page.goto("/products/ci-editor-shirt")
  await expect(page).toHaveURL(/\/merch\/ci-editor-shirt$/u)
  const wrongKind = await page.goto("/music-release/ci-editor-shirt")
  expect(wrongKind?.status()).toBe(404)
})

test("UI runtime quick shop opens and closes while optional chunks are delayed", async ({
  page,
}, testInfo) => {
  const chunksReady = Promise.withResolvers<void>()
  const productReady = Promise.withResolvers<void>()
  await page.route("**/api/search/products", (route) =>
    route.fulfill({ json: quickShopSearch })
  )
  await page.route(`**/api/products/${quickShopHandle}`, async (route) => {
    await productReady.promise
    await route.fulfill({ json: { product: quickShopProduct } })
  })
  try {
    const hydrated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/cart"
    )
    await page.goto("/catalog", { waitUntil: "load" })
    await hydrated
    await page
      .getByRole("searchbox", {
        name: "Search catalog by product or artist name",
      })
      .fill("runtime")
    const trigger = page.getByRole("button", {
      name: `Quick shop ${quickShopTitle}`,
    })
    await expect(trigger).toBeVisible()
    // Delay only code requested after the catalog is interactive. The drawer
    // must acknowledge the click and remain dismissible without that code.
    await page.route("**/_next/static/chunks/**", async (route) => {
      await chunksReady.promise
      await route.continue()
    })
    await trigger.press("Enter")
    const drawer = page.getByRole("dialog", { name: "Quick shop" })
    await expect(
      drawer.getByRole("heading", { name: "Loading release" })
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("quick-shop-delayed-chunks.png"),
    })
    await drawer.getByRole("button", { name: "Close quick shop" }).click()
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.press("Enter")
    await expect(drawer).toBeVisible()
    chunksReady.resolve()
    productReady.resolve()
    await expect(
      drawer.getByRole("heading", { name: quickShopTitle })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  } finally {
    chunksReady.resolve()
    productReady.resolve()
    await page.unrouteAll({ behavior: "wait" })
  }
})

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

test("UI runtime quick shop retries a failed optional chunk without losing the drawer", async ({
  page,
}, testInfo) => {
  await page.route("**/api/search/products", (route) =>
    route.fulfill({ json: quickShopSearch })
  )
  await page.route(`**/api/products/${quickShopHandle}`, (route) =>
    route.fulfill({ json: { product: quickShopProduct } })
  )
  const hydrated = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/cart"
  )
  await page.goto("/catalog", { waitUntil: "load" })
  await hydrated
  await page
    .getByRole("searchbox", {
      name: "Search catalog by product or artist name",
    })
    .fill("runtime")
  const trigger = page.getByRole("button", {
    name: `Quick shop ${quickShopTitle}`,
  })
  await expect(trigger).toBeVisible()
  let failChunks = true
  let rejectedChunks = 0
  await page.route("**/_next/static/chunks/**", async (route) => {
    if (failChunks) {
      rejectedChunks += 1
      await route.abort("failed")
    } else {
      await route.continue()
    }
  })
  await trigger.press("Enter")
  const drawer = page.getByRole("dialog", { name: "Quick shop" })
  await expect(
    drawer.getByRole("heading", { name: "Unable to load quick shop" })
  ).toBeVisible()
  expect(rejectedChunks).toBeGreaterThan(0)
  await expect(
    drawer.getByRole("button", { name: "Close quick shop" })
  ).toBeEnabled()
  await page.screenshot({
    path: testInfo.outputPath("quick-shop-code-error.png"),
  })
  failChunks = false
  await drawer.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(
    drawer.getByRole("heading", { name: quickShopTitle })
  ).toBeVisible()
  await expect(
    drawer.getByRole("button", { name: "Add to cart" })
  ).toBeEnabled()
  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
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
      // Pointer activation must survive the pressed style without moving the
      // hit target away before pointerup. Keyboard activation misses that bug.
      await next.click()
      await expectMainImage("back")
      await previous.click()
      await expectMainImage("front")
      if (testInfo.project.use.hasTouch) {
        await next.tap()
        await expectMainImage("back")
        await previous.tap()
        await expectMainImage("front")
      }
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
      await expectDrawerAccessibility(page, testInfo)
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
  // Wait for the mounted cart provider before sending keyboard input to
  // server-rendered controls whose React handlers may not be attached yet.
  const hydrated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/cart" &&
      response.request().method() === "GET"
  )
  await page.goto("/discography", { waitUntil: "domcontentloaded" })
  await hydrated
  await page.waitForLoadState("load")
  const cart = page.getByRole("button", {
    name: "Open cart, empty",
    exact: true,
  })
  await expectDecorativeIcons(cart)
  await cart.press("Enter")
  await expect(
    page.getByRole("dialog", { name: "Shopping cart" })
  ).toBeVisible()
  await expectDrawerAccessibility(page, testInfo)
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

for (const view of [
  { label: "the profile viewport", viewport: null },
  { label: "phone landscape", viewport: { width: 844, height: 390 } },
  { label: "200 percent reflow", viewport: { width: 720, height: 450 } },
]) {
  test(`UI runtime populated cart drawer keeps every control reachable at ${view.label}`, async ({
    page,
  }, testInfo) => {
    if (view.viewport) await page.setViewportSize(view.viewport)
    const items = [
      {
        id: "cali_CARTDRAWERCD",
        variant_id: "variant_CARTDRAWERCD",
        product_handle: "music-release-ci-gallery-runtime",
        product_title: "Cart Drawer Pressing",
        title: "Cart Drawer Pressing",
        variant_title: "CD",
        quantity: 2,
        unit_price: 15,
        subtotal: 30,
        total: 30,
        thumbnail: galleryImagePaths.front,
        product: { metadata: {} },
        variant: {
          title: "CD",
          manage_inventory: true,
          allow_backorder: false,
          inventory_quantity: 10,
        },
      },
      {
        id: "cali_CARTDRAWERSHIRT",
        variant_id: "variant_CARTDRAWERSHIRT",
        product_handle: "merch-ci-editor-shirt",
        product_title: "Cart Drawer Shirt",
        title: "Cart Drawer Shirt",
        variant_title: "M",
        quantity: 1,
        unit_price: 2.34,
        subtotal: 2.34,
        total: 2.34,
        thumbnail: galleryImagePaths.back,
        product: { metadata: {} },
        variant: {
          title: "M",
          manage_inventory: true,
          allow_backorder: false,
          inventory_quantity: 3,
        },
      },
    ]
    await page.route("**/api/cart", (route) =>
      route.fulfill({
        json: cartEnvelopeFrom({
          cart: {
            id: "cart_CARTDRAWER",
            currency_code: "usd",
            items,
            item_subtotal: 32.34,
            subtotal: 32.34,
            total: 32.34,
          },
        }),
      })
    )
    const hydrated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/cart" &&
        response.request().method() === "GET"
    )
    await page.goto("/discography", { waitUntil: "load" })
    await hydrated
    const trigger = page.getByRole("button", {
      name: "Open cart, 3 items",
      exact: true,
    })
    await trigger.press("Enter")
    const drawer = page.getByRole("dialog", {
      name: "Shopping cart",
      exact: true,
    })
    await expect(drawer.locator("article")).toHaveCount(2)
    await expect(drawer.locator("output")).toHaveText(["2", "1"])
    await expect(
      drawer.getByText("Only 3 available", { exact: true })
    ).toBeVisible()
    const controls = drawer.getByRole("button")
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded()
      const reachable = await control.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const topmost = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        )
        return (
          box.top >= 0 &&
          box.bottom <= innerHeight &&
          (topmost === element || element.contains(topmost))
        )
      })
      expect(reachable).toBe(true)
    }
    await expect(
      drawer.getByRole("button", { name: "Close cart", exact: true })
    ).toBeInViewport()
    await expectDrawerAccessibility(page, testInfo)
    await page.screenshot({
      path: testInfo.outputPath("populated-cart-dialog.png"),
      fullPage: true,
    })
    await page.keyboard.press("Escape")
    await expect(drawer).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}
