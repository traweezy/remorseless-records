import { mkdir } from "node:fs/promises"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const missingRoutes = [
  "/music-release/ci-missing-release",
  "/bundle/ci-missing-bundle",
  "/merch/ci-missing-merch",
  "/ci-missing-route",
]

for (const width of [390, 1440]) {
  for (const route of missingRoutes) {
    test(`missing page recovers under strict CSP: ${route} at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = []
      const violations: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.exposeFunction(
        "__recordRecoveryViolation",
        (value: string) => {
          violations.push(value)
        }
      )
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const record = Reflect.get(globalThis, "__recordRecoveryViolation")
          if (typeof record === "function") record(event.effectiveDirective)
        })
      })
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(route, { waitUntil: "domcontentloaded" })
      expect(response?.status()).toBe(404)
      const policy = response?.headers()["content-security-policy"] ?? ""
      expect(policy).toContain("require-trusted-types-for 'script'")
      expect(policy).not.toContain("'unsafe-eval'")
      await expect(
        page.getByRole("heading", { name: "Lost in the Static" })
      ).toBeVisible()
      await expect(
        page.getByText("A track skipped", { exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByText("The signal dropped", { exact: true })
      ).toHaveCount(0)
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
      expect(accessibility.violations).toEqual([])
      const directory = process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR
      if (directory) {
        await mkdir(directory, { recursive: true })
        await page.screenshot({
          path: path.join(
            directory,
            `not-found-${width}-${route.slice(1).replaceAll("/", "-")}.png`
          ),
          fullPage: true,
        })
      }
      const timeOrigin = await page.evaluate(() => performance.timeOrigin)
      const home = page.getByRole("link", { name: "Back to safety" })
      await home.focus()
      await expect(home).toBeFocused()
      expect(await home.evaluate((node) => getComputedStyle(node).cursor)).toBe(
        "pointer"
      )
      await home.press("Enter")
      await expect(page).toHaveURL(/\/$/u)
      await expect(page.getByRole("main")).toBeVisible()
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      await page.goBack()
      await expect(page).toHaveURL(new RegExp(`${route}$`, "u"))
      await expect(
        page.getByRole("heading", { name: "Lost in the Static" })
      ).toBeVisible()
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      expect(errors).toEqual([])
      expect(violations).toEqual([])
    })
  }
}
