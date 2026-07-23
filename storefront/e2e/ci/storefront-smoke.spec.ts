import { expect, test } from "@playwright/test"

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

test("catalog filters stay stable and combine predictably", async ({
  page,
}) => {
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
  await expect(
    drawer.getByRole("button", { name: /Show \d+ results/ })
  ).toBeVisible()

  await expect(page).toHaveURL(/type=merch/)
  await expect(page).toHaveURL(/genre=death-metal%2Cgrind/)

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
