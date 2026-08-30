import { mkdir } from "node:fs/promises"
import path from "node:path"

import { AxePuppeteer } from "@axe-core/puppeteer"
import puppeteer from "puppeteer"

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000"
const chromeExecutablePath =
  process.env.QA_CHROME_EXECUTABLE_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH
const disableChromeSandbox = process.env.QA_CHROME_NO_SANDBOX === "1"
const screenshotDirectory = process.env.QA_SCREENSHOT_DIR
const configuredPaths = process.env.QA_PATHS?.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)

const routes = configuredPaths?.length
  ? configuredPaths
  : [
      "/",
      "/catalog",
      "/discography",
      "/news",
      "/contact",
      "/about",
      "/submissions",
      "/faq",
      "/help/shipping",
      "/shipping",
      "/returns",
      "/terms",
      "/privacy",
      "/accessibility",
      "/cookies",
      "/cart",
      "/checkout",
    ]

const devices = [
  {
    name: "pixel-7",
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  },
  {
    name: "compact-phone",
    viewport: {
      width: 320,
      height: 568,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36",
  },
]

const toUrl = (route) => new URL(route, baseUrl).toString()

const routeSlug = (route) =>
  route === "/"
    ? "home"
    : route.replace(/^\/|\/$/g, "").replaceAll(/[^a-z0-9]+/gi, "-")

const collectLayoutMetrics = async (page) =>
  page.evaluate(() => {
    const isVisible = (element, style, bounds) =>
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      bounds.width > 0 &&
      bounds.height > 0

    const controls = Array.from(
      document.querySelectorAll(
        "a[href], button, input:not([type=hidden]), select, textarea, [role=button]"
      )
    )
      .filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        if (
          element.matches(":disabled") ||
          element.getAttribute("aria-hidden") === "true" ||
          element.tabIndex < 0
        ) {
          return false
        }
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        if (!isVisible(element, style, bounds)) {
          return false
        }
        const isInlineProseLink =
          element.tagName === "A" &&
          style.display === "inline" &&
          Boolean(element.closest("p, li, dd, dt"))
        const isVisuallyHidden =
          bounds.width <= 2 &&
          bounds.height <= 2 &&
          (style.position === "absolute" || style.clip !== "auto")
        return !isInlineProseLink && !isVisuallyHidden
      })
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return {
          height: Math.round(bounds.height * 100) / 100,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 80) ??
            element.tagName.toLowerCase(),
          width: Math.round(bounds.width * 100) / 100,
        }
      })

    const tinyText = Array.from(document.querySelectorAll("body *")).filter(
      (element) => {
        if (!(element instanceof HTMLElement) || element.children.length > 0) {
          return false
        }
        const text = element.textContent?.trim()
        if (!text) {
          return false
        }
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return (
          isVisible(element, style, bounds) &&
          Number.parseFloat(style.fontSize) < 11
        )
      }
    ).length

    return {
      bodyWidth: document.body.scrollWidth,
      controlCount: controls.length,
      documentWidth: document.documentElement.scrollWidth,
      smallControls: controls.filter(
        (control) => control.width < 24 || control.height < 24
      ),
      tinyText,
      touchPoints: navigator.maxTouchPoints,
      viewportWidth: window.innerWidth,
    }
  })

const run = async () => {
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true })
  }

  const browser = await puppeteer.launch({
    headless: true,
    ...(chromeExecutablePath ? { executablePath: chromeExecutablePath } : {}),
    ...(disableChromeSandbox
      ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
      : {}),
  })

  const failures = []
  const warnings = []

  try {
    for (const device of devices) {
      for (const route of routes) {
        const page = await browser.newPage()
        await page.setViewport(device.viewport)
        await page.setUserAgent(device.userAgent)
        await page.emulateMediaFeatures([
          { name: "prefers-reduced-motion", value: "reduce" },
        ])

        const label = `${device.name} ${route}`
        try {
          const response = await page.goto(toUrl(route), {
            waitUntil: "networkidle2",
            timeout: 45_000,
          })
          const status = response?.status() ?? 0
          if (status >= 400 || status === 0) {
            failures.push(`${label}: HTTP ${status || "unknown"}`)
            continue
          }

          const metrics = await collectLayoutMetrics(page)
          if (
            metrics.documentWidth > metrics.viewportWidth + 1 ||
            metrics.bodyWidth > metrics.viewportWidth + 1
          ) {
            failures.push(
              `${label}: horizontal overflow ` +
                `(viewport ${metrics.viewportWidth}, document ${metrics.documentWidth}, body ${metrics.bodyWidth})`
            )
          }
          if (metrics.touchPoints < 1) {
            failures.push(`${label}: touch input was not emulated`)
          }
          if (metrics.smallControls.length) {
            const examples = metrics.smallControls
              .slice(0, 5)
              .map(
                (control) =>
                  `"${control.label}" ${control.width}×${control.height}`
              )
              .join(", ")
            failures.push(
              `${label}: ${metrics.smallControls.length} standalone control(s) below 24×24 CSS px: ${examples}`
            )
          }
          if (metrics.tinyText) {
            warnings.push(
              `${label}: ${metrics.tinyText} visible leaf text node(s) below 11px`
            )
          }

          const axe = await new AxePuppeteer(page)
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
          for (const violation of axe.violations) {
            failures.push(
              `${label}: axe ${violation.id} (${violation.impact ?? "unknown"}) — ` +
                `${violation.help}; ${violation.nodes.length} node(s)`
            )
          }

          if (screenshotDirectory) {
            await page.screenshot({
              path: path.join(
                screenshotDirectory,
                `${device.name}-${routeSlug(route)}.png`
              ),
              fullPage: true,
            })
          }

          console.log(
            `PASS ${label} — ${metrics.controlCount} controls, ` +
              `${metrics.tinyText} tiny-text warning(s)`
          )
        } catch (error) {
          failures.push(
            `${label}: ${error instanceof Error ? error.message : String(error)}`
          )
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
  }

  if (warnings.length) {
    console.warn("\nMobile typography warnings:")
    for (const warning of warnings) {
      console.warn(`WARN ${warning}`)
    }
  }

  if (failures.length) {
    console.error("\nMobile audit failures:")
    for (const failure of failures) {
      console.error(`FAIL ${failure}`)
    }
    process.exitCode = 1
    return
  }

  console.log("\nMobile Chrome device audit passed.")
}

await run()
