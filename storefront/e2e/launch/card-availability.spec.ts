import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

for (const width of [320, 574, 768, 1440, 1920]) {
  test(`unavailable cards preserve readable metadata at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto("/music-release/ci-carousel-availability")
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
    for (const state of ["available", "sold-out", "unavailable"]) {
      const href = `/music-release/ci-availability-${state}`
      const visibleCard = carousel.locator(
        `.splide__slide.is-visible a[href="${href}"]`
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
      for (let step = 0; step < 6; step += 1) {
        if ((await fullyVisibleIndex()) >= 0) break
        await expect(next).toBeEnabled()
        await next.focus()
        await next.press("Enter")
        await waitForSlidePosition()
      }
      const index = await fullyVisibleIndex()
      expect(index).toBeGreaterThanOrEqual(0)
      const slideId = await visibleCard
        .nth(index)
        .evaluate((element) => element.closest(".splide__slide")!.id)
      const cardSelector = `#${slideId} a[href="${href}"]`
      const card = carousel.locator(cardSelector)
      const title = `Carousel ${state} pressing`
      const artist = `Fixture ${state} artist`
      await expect(card.getByRole("heading")).toHaveText(title)
      await expect(card.getByText(artist, { exact: true })).toBeVisible()
      const quickShop = card.getByRole("button", {
        name: `Quick shop ${title}`,
      })
      const image = card.getByRole("img", { name: title })
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth
          )
        )
        .toBeGreaterThan(0)
      if (state === "available") {
        await expect(quickShop).toBeEnabled()
        await expect(card.getByText("$15.00", { exact: true })).toBeVisible()
      } else {
        await expect(quickShop).toBeDisabled()
        await expect(
          card
            .getByText(state === "sold-out" ? "Sold out" : "Unavailable", {
              exact: true,
            })
            .first()
        ).toBeVisible()
        expect(await card.locator("h3 + p").innerText()).toBe("")
        const entry = carousel.locator(".splide__slide.is-visible a").first()
        await entry.focus()
        // Enter the native tab order and return to its first visible link.
        // At the widest breakpoint both carousel arrows are disabled.
        await page.keyboard.press("Tab")
        await page.keyboard.press("Shift+Tab")
        for (let step = 0; step < 24; step += 1) {
          if (
            await card.evaluate((element) => element === document.activeElement)
          )
            break
          await page.keyboard.press("Tab")
        }
        await expect(card).toBeFocused()
        await quickShop.focus()
        await expect(quickShop).not.toBeFocused()
        await expect(card).toBeFocused()
        await expect
          .poll(() =>
            quickShop.evaluate(
              (element) => getComputedStyle(element.parentElement!).opacity
            )
          )
          .toBe("1")
      }
      const geometry = await image.evaluate((element) => {
        const media = element.parentElement!
        const card = element.closest("a")!
        const mediaBounds = media.getBoundingClientRect()
        const trackBounds = card
          .closest(".splide__track")!
          .getBoundingClientRect()
        const artist = card.querySelector("h3")!.previousElementSibling!
        const artistBounds = artist.getBoundingClientRect()
        const overlays = Array.from(
          card.querySelectorAll('[aria-hidden="true"]')
        )
          .filter((node) => node.classList.contains("bg-black/45"))
          .map((node) => {
            const bounds = node.getBoundingClientRect()
            return {
              insideArtwork: node.parentElement === media,
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              bottom: bounds.bottom,
            }
          })
        return {
          artwork: {
            left: mediaBounds.left,
            top: mediaBounds.top,
            width: mediaBounds.width,
            height: mediaBounds.height,
          },
          artistTop: artistBounds.top,
          artworkWithinTrack:
            mediaBounds.left >= trackBounds.left - 1 &&
            mediaBounds.right <= trackBounds.right + 1 &&
            mediaBounds.top >= trackBounds.top - 1 &&
            mediaBounds.bottom <= trackBounds.bottom + 1,
          artistUnclipped:
            artist.scrollWidth <= artist.clientWidth &&
            artist.scrollHeight <= artist.clientHeight,
          imageFit: getComputedStyle(element).objectFit,
          imageFilter: getComputedStyle(element).filter,
          overlays,
        }
      })
      expect(geometry.artistUnclipped).toBe(true)
      expect(geometry.artworkWithinTrack).toBe(true)
      expect(geometry.imageFit).toBe("contain")
      expect(geometry.overlays).toHaveLength(state === "available" ? 0 : 1)
      for (const overlay of geometry.overlays) {
        expect(overlay.insideArtwork).toBe(true)
        expect(overlay.left).toBeCloseTo(geometry.artwork.left, 1)
        expect(overlay.top).toBeCloseTo(geometry.artwork.top, 1)
        expect(overlay.width).toBeCloseTo(geometry.artwork.width, 1)
        expect(overlay.height).toBeCloseTo(geometry.artwork.height, 1)
        expect(overlay.bottom).toBeLessThanOrEqual(geometry.artistTop)
        expect(geometry.imageFilter).toContain("grayscale(1)")
        expect(geometry.imageFilter).toContain("brightness(0.75)")
      }
      const readPaintedMetadata = () =>
        card.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const track = element
            .closest(".splide__track")!
            .getBoundingClientRect()
          const clippedCharacters: string[] = []
          const offsets: Array<{ className: string; scrollLeft: number }> = []
          for (const node of [
            element.querySelector("h3")!,
            element.querySelector("h3")!.previousElementSibling!,
          ]) {
            let left = Math.max(bounds.left, track.left)
            let right = Math.min(bounds.right, track.right)
            let top = Math.max(bounds.top, track.top)
            let bottom = Math.min(bounds.bottom, track.bottom)
            for (
              let parent: Element | null = node;
              parent && parent !== element;
              parent = parent.parentElement
            ) {
              const rect = parent.getBoundingClientRect()
              const style = getComputedStyle(parent)
              offsets.push({
                className: parent.className,
                scrollLeft: parent.scrollLeft,
              })
              if (
                ["hidden", "clip", "scroll", "auto"].includes(style.overflowX)
              ) {
                left = Math.max(left, rect.left)
                right = Math.min(right, rect.right)
              }
              if (
                ["hidden", "clip", "scroll", "auto"].includes(style.overflowY)
              ) {
                top = Math.max(top, rect.top)
                bottom = Math.min(bottom, rect.bottom)
              }
            }
            const text = node.firstChild!
            const value = text.textContent ?? ""
            for (let index = 0; index < value.length; index += 1) {
              if (!value[index]!.trim()) continue
              const range = document.createRange()
              range.setStart(text, index)
              range.setEnd(text, index + 1)
              const rect = range.getBoundingClientRect()
              if (
                rect.left < left - 1 ||
                rect.right > right + 1 ||
                rect.top < top - 1 ||
                rect.bottom > bottom + 1
              ) {
                clippedCharacters.push(value[index]!)
              }
            }
          }
          return {
            cardWithinTrack:
              bounds.left >= track.left - 1 &&
              bounds.right <= track.right + 1 &&
              bounds.top >= track.top - 1 &&
              bounds.bottom <= track.bottom + 1,
            clippedCharacters,
            offsets,
          }
        })
      const metadataBeforeAxe = await readPaintedMetadata()
      expect(metadataBeforeAxe.cardWithinTrack).toBe(true)
      expect(metadataBeforeAxe.clippedCharacters).toEqual([])
      // Repeated carousel products can leave another copy at a clipped edge.
      // Analyze the same complete card selected by the geometry assertions.
      const metadataSelector = `${cardSelector} p:has(+ h3)`
      const accessibility = await new AxeBuilder({ page })
        .include(metadataSelector)
        .withRules(["color-contrast"])
        .analyze()
      expect(accessibility.violations).toEqual([])
      expect(accessibility.incomplete).toEqual([])
      expect(
        accessibility.passes
          .find((rule) => rule.id === "color-contrast")
          ?.nodes.some((node) => node.html.includes(artist))
      ).toBe(true)
      const fullCardAccessibility = await new AxeBuilder({ page })
        .include(cardSelector)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
      expect(fullCardAccessibility.violations).toEqual([])
      expect(fullCardAccessibility.incomplete).toEqual([])
      const metadataAfterAxe = await readPaintedMetadata()
      expect(metadataAfterAxe.cardWithinTrack).toBe(true)
      expect(metadataAfterAxe.clippedCharacters).toEqual([])
      expect(metadataAfterAxe.offsets).toEqual(metadataBeforeAxe.offsets)
      const directory = process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR
      if (directory) {
        await mkdir(directory, { recursive: true })
        await carousel.scrollIntoViewIfNeeded()
        await carousel.evaluate((element) => {
          const headerBottom =
            document.querySelector("header")?.getBoundingClientRect().bottom ??
            0
          const top = element.getBoundingClientRect().top
          if (top < headerBottom + 16) {
            window.scrollBy({
              top: top - headerBottom - 16,
              behavior: "instant",
            })
          }
        })
        await carousel.screenshot({
          path: path.join(
            directory,
            `carousel-availability-${width}-${state}.png`
          ),
        })
        await writeFile(
          path.join(directory, `carousel-availability-${width}-${state}.json`),
          `${JSON.stringify({ width, state, geometry, metadataBeforeAxe, metadataAfterAxe, accessibility, fullCardAccessibility }, null, 2)}\n`
        )
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
