import { mkdir } from "node:fs/promises"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

for (const width of [320, 768, 1440]) {
  test(`catalog results preserve the heading hierarchy at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto("/catalog")
    expect(response?.status()).toBe(200)
    const reject = page.getByRole("button", { name: "Reject non-essential" })
    if (await reject.isVisible()) await reject.click()

    const results = page.getByRole("region", { name: "Catalog results" })
    const firstCardHeading = results.getByRole("heading", { level: 3 }).first()
    await expect(firstCardHeading).toBeVisible()
    const accessibility = await new AxeBuilder({ page })
      .withRules(["heading-order"])
      .analyze()
    const geometry = await results.evaluate((element) => {
      const heading = element.querySelector("h2")
      const card = element.querySelector("h3")
      return {
        results: element.getBoundingClientRect().toJSON(),
        heading: heading?.getBoundingClientRect().toJSON() ?? null,
        firstCard: card?.closest("a")?.getBoundingClientRect().toJSON() ?? null,
        headings: Array.from(
          document.querySelectorAll("main h1, main h2, main h3")
        ).map((node) => ({ tag: node.tagName, text: node.textContent })),
      }
    })
    await testInfo.attach("catalog-heading-audit", {
      body: JSON.stringify({ accessibility, geometry }),
      contentType: "application/json",
    })
    const directory = process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR
    if (directory) {
      await mkdir(directory, { recursive: true })
      await page.screenshot({
        path: path.join(directory, `catalog-heading-${width}.png`),
      })
    }

    expect(accessibility.violations).toEqual([])
    expect(accessibility.incomplete).toEqual([])
    const resultsHeading = results.getByRole("heading", {
      name: "Catalog results",
      level: 2,
      exact: true,
    })
    await expect(resultsHeading).toHaveCount(1)
    await expect(
      page.getByRole("heading", { name: "Catalog", level: 1, exact: true })
    ).toHaveCount(1)
    expect(
      await firstCardHeading.evaluate((element) => {
        const heading = element.closest("section")?.querySelector("h2")
        return (
          heading !== null &&
          heading !== undefined &&
          Boolean(
            heading.compareDocumentPosition(element) &
              Node.DOCUMENT_POSITION_FOLLOWING
          )
        )
      })
    ).toBe(true)
    const bounds = await resultsHeading.boundingBox()
    expect(bounds?.width).toBeLessThanOrEqual(1)
    expect(bounds?.height).toBeLessThanOrEqual(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

for (const width of [768, 1440]) {
  test(`catalog toolbar retains text contrast above artwork at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto("/catalog")
    expect(response?.status()).toBe(200)
    const reject = page.getByRole("button", { name: "Reject non-essential" })
    if (await reject.isVisible()) await reject.click()
    const results = page.getByRole("region", { name: "Catalog results" })
    await expect(
      results.getByRole("heading", { level: 3 }).first()
    ).toBeVisible()
    await page.mouse.wheel(0, 500)
    const tagline = page.getByText("Tuned in · Brutalized", { exact: true })
    await expect(tagline).toBeVisible()
    await expect
      .poll(() =>
        tagline.evaluate(
          (element) => element.closest("header")!.getBoundingClientRect().top
        )
      )
      .toBe(64)

    const contrast = await tagline.evaluate((element) => {
      const style = getComputedStyle(element)
      const header = element.closest("header")!
      const headerStyle = getComputedStyle(header)
      const canvas = document.createElement("canvas")
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext("2d", { willReadFrequently: true })!
      // White is the brightest possible backdrop under this translucent header.
      // The canvas uses the browser's actual CSS color conversion/composition.
      context.fillStyle = "white"
      context.fillRect(0, 0, 1, 1)
      context.fillStyle = headerStyle.backgroundColor
      context.fillRect(0, 0, 1, 1)
      const background = Array.from(context.getImageData(0, 0, 1, 1).data)
      context.fillStyle = style.color
      context.fillRect(0, 0, 1, 1)
      const foreground = Array.from(context.getImageData(0, 0, 1, 1).data)
      const luminance = (color: number[]) =>
        color.slice(0, 3).reduce((value, channel, index) => {
          const normalized = channel / 255
          const linear =
            normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4
          return value + linear * [0.2126, 0.7152, 0.0722][index]
        }, 0)
      const glyphs: boolean[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        for (let index = 0; index < (text.textContent?.length ?? 0); index++) {
          if (/\s/u.test(text.textContent![index])) continue
          const range = document.createRange()
          range.setStart(text, index)
          range.setEnd(text, index + 1)
          const bounds = range.getBoundingClientRect()
          const hit = document.elementFromPoint(
            (bounds.left + bounds.right) / 2,
            (bounds.top + bounds.bottom) / 2
          )
          glyphs.push(
            bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.left >= 0 &&
              bounds.right <= innerWidth &&
              bounds.top >= 0 &&
              bounds.bottom <= innerHeight &&
              hit !== null &&
              element.contains(hit)
          )
        }
      }
      return {
        color: style.color,
        backgroundColor: headerStyle.backgroundColor,
        elementOpacity: style.opacity,
        headerOpacity: headerStyle.opacity,
        headerFilter: headerStyle.filter,
        background,
        foreground,
        worstWhiteBackdropContrast:
          (luminance(foreground) + 0.05) / (luminance(background) + 0.05),
        glyphs,
      }
    })
    await testInfo.attach("catalog-toolbar-contrast", {
      body: JSON.stringify(contrast),
      contentType: "application/json",
    })
    const directory = process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR
    if (directory) {
      await mkdir(directory, { recursive: true })
      await page.screenshot({
        path: path.join(directory, `catalog-toolbar-${width}.png`),
      })
    }
    expect(contrast.elementOpacity).toBe("1")
    expect(contrast.headerOpacity).toBe("1")
    expect(contrast.headerFilter).toBe("none")
    expect(contrast.worstWhiteBackdropContrast).toBeGreaterThanOrEqual(4.5)
    expect(contrast.glyphs).toHaveLength(18)
    expect(contrast.glyphs.every(Boolean)).toBe(true)
    expect(errors).toEqual([])
  })
}
