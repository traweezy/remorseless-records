import { mkdir } from "node:fs/promises"
import path from "node:path"

import { expect, test, type Locator } from "@playwright/test"

const shapes = {
  square: [800, 800],
  portrait: [600, 1000],
  landscape: [1200, 600],
} as const

for (const width of [320, 574, 768, 1440, 1920]) {
  test(`carousel retains complete artwork and metadata at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.route("**/__e2e__/artwork-*.svg", async (route) => {
      const shape = new URL(route.request().url()).pathname.match(
        /artwork-(square|portrait|landscape)\.svg$/u
      )?.[1] as keyof typeof shapes | undefined
      if (!shape) throw new Error("Unknown owned artwork fixture")
      const [w, h] = shapes[shape]
      await route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#222"/><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#ff3333" stroke-width="4"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.4}" fill="#ddd"/></svg>`,
      })
    })
    const response = await page.goto("/music-release/ci-carousel-artwork")
    expect(response?.status()).toBe(200)
    const reject = page.getByRole("button", { name: "Reject non-essential" })
    if (await reject.isVisible()) await reject.click()
    const carousel = page.getByRole("region", { name: "Related Assaults" })
    await expect(carousel).toBeVisible()
    const next = carousel.getByRole("button", {
      name: /^(Next slide|Go to first slide)$/u,
    })
    const waitForSlidePosition = async () => {
      let previous = ""
      let stable = 0
      await expect
        .poll(async () => {
          const current = await carousel
            .locator(".splide__list")
            .evaluate((element) => getComputedStyle(element).transform)
          stable = current === previous ? stable + 1 : 0
          previous = current
          return stable
        })
        .toBeGreaterThanOrEqual(2)
    }
    if (width < 1920) {
      await expect(next).toBeEnabled()
      const unfocusedShadow = await next.evaluate(
        (element) => getComputedStyle(element).boxShadow
      )
      await next.focus()
      // Enter keyboard modality and return through the real tab order.
      await page.keyboard.press("Tab")
      await page.keyboard.press("Shift+Tab")
      await expect(next).toBeFocused()
      expect(
        await next.evaluate((element) => getComputedStyle(element).cursor)
      ).toBe("pointer")
      // The same native control works from a keyboard and has visible focus.
      expect(
        await next.evaluate((element) => getComputedStyle(element).boxShadow)
      ).not.toBe(unfocusedShadow)
      await next.press("Enter")
      await waitForSlidePosition()
    } else {
      // All six slides fit at the widest breakpoint; there is nothing to advance.
      await expect(next).toBeDisabled()
      await expect(carousel.locator(".splide__slide.is-visible")).toHaveCount(6)
    }
    for (const shape of Object.keys(shapes)) {
      const cardSelector = `a[href="/music-release/ci-carousel-${shape}"]`
      const visibleCard = carousel.locator(
        `.splide__slide.is-visible ${cardSelector}`
      )
      const fullyVisibleIndex = () =>
        visibleCard.evaluateAll((elements) =>
          elements.findIndex((element) => {
            const card = element.getBoundingClientRect()
            const track = element
              .closest(".splide__track")!
              .getBoundingClientRect()
            return card.left >= track.left - 1 && card.right <= track.right + 1
          })
        )
      // Advance through visible slides using the real carousel controls.
      for (let step = 0; step < 6; step += 1) {
        if ((await fullyVisibleIndex()) >= 0) break
        await next.click()
        await waitForSlidePosition()
      }
      const index = await fullyVisibleIndex()
      expect(index).toBeGreaterThanOrEqual(0)
      const card: Locator = visibleCard.nth(index)
      await expect(card).toBeVisible()
      const image = card.getByRole("img")
      await expect(image).toBeVisible()
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth
          )
        )
        .toBeGreaterThan(0)
      const geometry = await image.evaluate((element) => {
        const media = element.parentElement!
        const card = element.closest("a")!
        const bounds = media.getBoundingClientRect()
        const cardBounds = card.getBoundingClientRect()
        const titleBounds = card.querySelector("h3")!.getBoundingClientRect()
        const title = card.querySelector("h3")!
        const priceBounds = card
          .querySelector("h3 + p")!
          .getBoundingClientRect()
        const image = element as HTMLImageElement
        return {
          width: bounds.width,
          height: bounds.height,
          fit: getComputedStyle(element).objectFit,
          transform: getComputedStyle(element).transform,
          intrinsicRatio: image.naturalWidth / image.naturalHeight,
          titleWithinCard:
            titleBounds.top >= cardBounds.top &&
            titleBounds.bottom <= cardBounds.bottom,
          titleUnclipped:
            title.scrollWidth <= title.clientWidth &&
            title.scrollHeight <= title.clientHeight,
          priceWithinCard:
            priceBounds.top >= cardBounds.top &&
            priceBounds.bottom <= cardBounds.bottom,
        }
      })
      expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(1)
      expect(geometry.fit).toBe("contain")
      expect(geometry.transform).toBe("none")
      const [naturalWidth, naturalHeight] = shapes[shape as keyof typeof shapes]
      expect(geometry.intrinsicRatio).toBe(naturalWidth / naturalHeight)
      expect(geometry.titleWithinCard).toBe(true)
      expect(geometry.titleUnclipped).toBe(true)
      expect(geometry.priceWithinCard).toBe(true)
      await expect(card.getByRole("heading")).toContainText(shape)
      await expect(card.getByText("$15.00", { exact: true })).toBeVisible()
      const directory = process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR
      if (directory) {
        await mkdir(directory, { recursive: true })
        await carousel.scrollIntoViewIfNeeded()
        await carousel.evaluate((element) => {
          const header = document.querySelector("header")
          const headerBottom = header?.getBoundingClientRect().bottom ?? 0
          const top = element.getBoundingClientRect().top
          if (top < headerBottom + 16) {
            window.scrollBy({
              top: top - headerBottom - 16,
              behavior: "instant",
            })
          }
        })
        await carousel.screenshot({
          path: path.join(directory, `carousel-artwork-${width}-${shape}.png`),
        })
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(errors).toEqual([])
  })
}
