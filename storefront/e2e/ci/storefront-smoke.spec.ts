import { expect, test } from "@playwright/test"

const routes = [
  "/about",
  "/accessibility",
  "/cookies",
  "/terms",
] as const

for (const path of routes) {
  test(`${path} stays within the emulated mobile viewport`, async ({ page }) => {
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
