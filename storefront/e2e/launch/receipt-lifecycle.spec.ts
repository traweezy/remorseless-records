import { mkdir } from "node:fs/promises"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Route } from "@playwright/test"

import { createConfirmationReceipt, installCatalog } from "./launch-fixtures"

const receiptPath = "/api/checkout/confirmation"
const expiredDetail =
  "This secure receipt has expired. Check your email for the order confirmation."
const screenshotDirectory =
  process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR ??
  "/tmp/remorseless-storefront-launch"

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`receipt authority survives SPA revisits and expiry (${viewport.name})`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(45_000)
    if (!baseURL) throw new Error("Receipt acceptance requires a base URL")
    const origin = new URL(baseURL).origin
    const unexpectedErrors: string[] = []
    const unexpectedResponses: string[] = []
    page.on("pageerror", (error) => unexpectedErrors.push(error.name))
    page.on("console", (message) => {
      if (message.type() !== "error") return
      const location = message.location().url
      // Only the deliberate expired-grant HTTP response is expected here.
      if (
        location === `${origin}${receiptPath}` &&
        /^Failed to load resource: the server responded with a status of 404(?: \(Not Found\))?$/u.test(
          message.text()
        )
      )
        return
      unexpectedErrors.push(message.text().slice(0, 200))
    })
    page.on("response", (response) => {
      const url = new URL(response.url())
      if (url.origin !== origin || response.status() < 400) return
      if (url.pathname === receiptPath && response.status() === 404) return
      unexpectedResponses.push(`${url.pathname}:${response.status()}`)
    })

    const first = {
      ...createConfirmationReceipt(),
      email: "first-order@example.test",
      orderNumber: "1042",
    }
    const second = {
      ...createConfirmationReceipt(),
      email: "second-order@example.test",
      orderNumber: "1043",
    }
    let phase: "first" | "pending-second" | "expired" = "first"
    let heldResponse: Route | undefined
    let requests = 0
    await installCatalog(page)
    await page.route(`**${receiptPath}`, async (route) => {
      expect(route.request().method()).toBe("GET")
      requests += 1
      if (phase === "pending-second") {
        expect(heldResponse).toBeUndefined()
        heldResponse = route
        return
      }
      await route.fulfill({
        status: phase === "first" ? 200 : 404,
        contentType:
          phase === "first" ? "application/json" : "application/problem+json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(
          phase === "first"
            ? { receipt: first }
            : {
                type: "about:blank",
                title: "Receipt is unavailable",
                status: 404,
                code: "receipt_missing",
                detail: expiredDetail,
              }
        ),
      })
    })

    try {
      await page.setViewportSize(viewport)
      await page.goto("/checkout/confirmation", {
        waitUntil: "domcontentloaded",
      })
      await expect(page.getByText(first.email, { exact: true })).toBeVisible()
      const reject = page.getByRole("button", { name: "Reject non-essential" })
      if (await reject.isVisible()) await reject.click()
      const timeOrigin = await page.evaluate(() => performance.timeOrigin)

      await page.getByRole("link", { name: "Continue shopping" }).click()
      await expect(page).toHaveURL(/\/catalog$/u)
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      phase = "pending-second"
      await page.goBack()
      await expect(page).toHaveURL(/\/checkout\/confirmation$/u)
      await expect.poll(() => heldResponse !== undefined).toBe(true)
      await expect(page.getByText("Loading order receipt…")).toBeAttached()
      await expect(page.getByText(first.email, { exact: true })).toHaveCount(0)
      await expect(
        page.getByRole("heading", { name: "Thank you" })
      ).toHaveCount(0)
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      await mkdir(screenshotDirectory, { recursive: true })
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `receipt-pending-${viewport.name}.png`
        ),
        fullPage: true,
      })

      const pending = heldResponse
      if (!pending) throw new Error("Revisit did not request receipt authority")
      heldResponse = undefined
      await pending.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ receipt: second }),
      })
      await expect(page.getByText(second.email, { exact: true })).toBeVisible()
      await expect(page.getByText(first.email, { exact: true })).toHaveCount(0)
      expect(requests).toBe(2)

      await page.getByRole("link", { name: "Continue shopping" }).click()
      await expect(page).toHaveURL(/\/catalog$/u)
      phase = "expired"
      await page.goBack()
      await expect(
        page
          .getByRole("alert")
          .getByText("Receipt is unavailable", { exact: true })
      ).toBeVisible()
      await expect(page.getByText(expiredDetail, { exact: true })).toBeVisible()
      for (const email of [first.email, second.email]) {
        await expect(page.getByText(email, { exact: true })).toHaveCount(0)
      }
      await expect(
        page.getByRole("heading", { name: "Thank you" })
      ).toHaveCount(0)
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
      expect(requests).toBeGreaterThanOrEqual(3)
      expect(requests).toBeLessThanOrEqual(4)
      const accessibility = await new AxeBuilder({ page })
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
      expect(accessibility.violations).toEqual([])
      await page.screenshot({
        path: path.join(
          screenshotDirectory,
          `receipt-expired-${viewport.name}.png`
        ),
        fullPage: true,
      })
      expect(unexpectedErrors).toEqual([])
      expect(unexpectedResponses).toEqual([])
    } finally {
      await heldResponse?.abort()
    }
  })
}
