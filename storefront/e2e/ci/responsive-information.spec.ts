import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

for (const width of [320, 768, 844, 1024]) {
  test(`UI runtime information pages and navigation fit ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 740 })
    for (const route of [
      "/contact",
      "/faq",
      "/privacy",
      "/cookies",
      "/terms",
    ]) {
      await page.goto(route)
      const consent = page.getByRole("button", {
        name: "Reject non-essential",
        exact: true,
      })
      if (await consent.isVisible()) await consent.click()
      await expect(page.locator("main h1")).toHaveCount(1)
      if (route === "/faq") {
        const questions = page.locator("main button[aria-expanded]")
        for (const question of await questions.all()) {
          if ((await question.getAttribute("aria-expanded")) === "true")
            await question.click()
          await expect(question).toHaveAttribute("aria-expanded", "false")
          await question.press("Enter")
          await expect(question).toHaveAttribute("aria-expanded", "true")
          const answerId = await question.getAttribute("aria-controls")
          expect(answerId).toBeTruthy()
          await expect(page.locator(`[id="${answerId}"]`)).toBeVisible()
        }
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1
          )
        )
        .toBe(true)
      const clippedControls = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main button, main a")]
          .filter((element) =>
            ["flex", "inline-flex"].includes(getComputedStyle(element).display)
          )
          .filter((element) => {
            const box = element.getBoundingClientRect()
            if (!box.width || !box.height) return false
            const style = getComputedStyle(element)
            const range = document.createRange()
            range.selectNodeContents(element)
            const text = range.getBoundingClientRect()
            const form = element.closest("form")?.getBoundingClientRect()
            return (
              text.left < box.left + Number.parseFloat(style.paddingLeft) - 1 ||
              text.right >
                box.right - Number.parseFloat(style.paddingRight) + 1 ||
              (form !== undefined && box.right > form.right - 1)
            )
          })
          .map((element) => element.textContent?.trim())
      )
      expect(clippedControls).toEqual([])
      const menu = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      })
      if (width < 1024) {
        await expect(menu).toBeVisible()
        if (route === "/terms") {
          await menu.click()
          const drawer = page.getByRole("dialog", {
            name: "Navigation",
            exact: true,
          })
          await expect(drawer).toBeVisible()
          await expect(
            drawer.getByRole("link", { name: "Catalog" })
          ).toBeVisible()
          await expect(
            drawer.getByRole("link", { name: "Discography" })
          ).toBeVisible()
          await drawer.getByRole("button", { name: "Close navigation" }).click()
          await expect(drawer).toHaveCount(0)
          await expect(menu).toBeFocused()
        }
      } else {
        await expect(menu).toBeHidden()
        await expect(
          page.locator("header nav").getByRole("link", { name: "Catalog" })
        ).toBeVisible()
      }
      expect(
        (await new AxeBuilder({ page }).include("main").analyze()).violations
      ).toEqual([])
      if (width === 320 || route === "/terms") {
        await page.screenshot({
          path: testInfo.outputPath(`${route.slice(1)}-${width}.png`),
          fullPage: true,
        })
      }
    }
  })
}
