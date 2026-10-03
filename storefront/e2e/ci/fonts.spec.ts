import { expect, test } from "@playwright/test"
import { preloads } from "../../public/fonts/sources.json"

// Exercise the rendered CSS variables as well as font downloads: defining the
// family only on body leaves root-level theme aliases unresolved.
test("UI runtime local fonts resolve all brand tokens without external requests", async ({
  page,
  request,
}, testInfo) => {
  const externalFonts: string[] = []
  page.on("request", (request) => {
    if (
      /fonts\.(googleapis|gstatic)\.com/u.test(new URL(request.url()).hostname)
    ) {
      externalFonts.push(request.url())
    }
  })
  await page.goto("/", { waitUntil: "load" })
  const fonts = await page.evaluate(async () => {
    const families = ["Bebas Neue", "Teko", "Inter", "JetBrains Mono"]
    const loaded = await Promise.all(
      families.map(async (family) => ({
        family,
        faces: (
          await document.fonts.load(
            `400 16px "${family}"`,
            "Release notes 0123"
          )
        ).map((face) => face.status),
      }))
    )
    const style = getComputedStyle(document.documentElement)
    return {
      loaded,
      tokens: Object.fromEntries(
        [
          "--font-bebas",
          "--font-display",
          "--font-headline",
          "--font-sans",
          "--font-mono",
        ].map((name) => [name, style.getPropertyValue(name)])
      ),
    }
  })
  for (const font of fonts.loaded) {
    expect(font.faces, font.family).not.toHaveLength(0)
    expect(
      font.faces.every((status) => status === "loaded"),
      font.family
    ).toBe(true)
  }
  expect(fonts.tokens["--font-bebas"]).toContain("Bebas Neue")
  expect(fonts.tokens["--font-display"]).toContain("Bebas Neue")
  expect(fonts.tokens["--font-headline"]).toContain("Teko")
  expect(fonts.tokens["--font-sans"]).toContain("Inter")
  expect(fonts.tokens["--font-mono"]).toContain("JetBrains Mono")
  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(4)
  for (const href of preloads) {
    const response = await request.get(href)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("font/woff2")
    expect(response.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    )
  }
  expect(externalFonts).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath("local-fonts-home.png"),
    fullPage: true,
  })
})
