import { createServer } from "node:http"
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
    const hostname = new URL(request.url()).hostname
    if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(hostname)) {
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

test("UI runtime Stripe's public fonts load across origins without broadening app access", async ({
  page,
  request,
  baseURL,
}) => {
  const fontUrl = new URL("/fonts/stripe-inter.css", baseURL).href
  const stylesheet = await request.get(fontUrl)
  expect(stylesheet.status()).toBe(200)
  expect(stylesheet.headers()["access-control-allow-origin"]).toBe("*")
  expect(stylesheet.headers()["cross-origin-resource-policy"]).toBe(
    "cross-origin"
  )
  expect(stylesheet.headers()["content-security-policy"]).toBeUndefined()
  const app = await request.get("/")
  expect(app.headers()["access-control-allow-origin"]).toBeUndefined()
  expect(app.headers()["cross-origin-resource-policy"]).toBe("same-site")
  // Serve a real second loopback origin. A route.fulfill-only origin has no
  // resolved IP and triggers Chromium's private-network access protection.
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end(
      `<!doctype html><html lang="en"><head><title>Hosted font fixture</title><link rel="stylesheet" href="${fontUrl}"></head><body><h1 style="font-family:Inter">Payment font</h1></body></html>`
    )
  })
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve))
  try {
    const address = fixture.address()
    if (!address || typeof address === "string")
      throw new Error("Font fixture address unavailable")
    const fixtureOrigin = `http://127.0.0.1:${address.port}/`
    expect(new URL(fontUrl).origin).not.toBe(new URL(fixtureOrigin).origin)
    await page.goto(fixtureOrigin)
    const statuses = await page.evaluate(async () => {
      const faces = await document.fonts.load('500 16px "Inter"', "Payment Δ")
      return faces.map((face) => face.status)
    })
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.every((status) => status === "loaded")).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
