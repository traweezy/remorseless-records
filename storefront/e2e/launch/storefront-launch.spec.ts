import { mkdir } from "node:fs/promises"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import {
  installCatalog,
  installCheckout,
  installConfirmation,
  installPopulatedCart,
  installRecovery,
} from "./launch-fixtures"

const screenshotDirectory =
  process.env.STOREFRONT_LAUNCH_SCREENSHOT_DIR ??
  "/tmp/remorseless-storefront-launch"

type RuntimeCapture = {
  consoleErrors: string[]
  failedRequests: string[]
  failedResponses: string[]
}

const startRuntimeCapture = (page: Page): RuntimeCapture => {
  const capture: RuntimeCapture = {
    consoleErrors: [],
    failedRequests: [],
    failedResponses: [],
  }

  page.on("console", (message) => {
    if (message.type() === "error") {
      capture.consoleErrors.push(message.text().slice(0, 300))
    }
  })
  page.on("pageerror", (error) => {
    capture.consoleErrors.push(error.message.slice(0, 300))
  })
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown"
    if (failure !== "net::ERR_ABORTED") {
      capture.failedRequests.push(
        `${request.method()} ${new URL(request.url()).pathname}: ${failure}`
      )
    }
  })
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.origin === "http://127.0.0.1:3000" && response.status() >= 400) {
      capture.failedResponses.push(
        `${response.request().method()} ${url.pathname}: ${response.status()}`
      )
    }
  })

  return capture
}

const rejectNonEssential = async (page: Page): Promise<void> => {
  const reject = page.getByRole("button", { name: "Reject non-essential" })
  const consentVisible = await reject
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (consentVisible) {
    await reject.click()
    await expect(reject).toBeHidden()
  }
}

const auditKeyboardFocus = async (page: Page): Promise<unknown[]> => {
  const findings: unknown[] = []
  let auditedElements = 0
  await page.locator("#main-content").focus()
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab")
    const finding = await page.evaluate(() => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || active === document.body) {
        return { code: "focus_boundary" }
      }

      const bounds = active.getBoundingClientRect()
      const style = getComputedStyle(active)
      const focusVisible = active.matches(":focus-visible")
      const hasIndicator =
        (style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none"
      const visibleLeft = Math.max(0, bounds.left)
      const visibleRight = Math.min(window.innerWidth, bounds.right)
      const visibleTop = Math.max(0, bounds.top)
      const visibleBottom = Math.min(window.innerHeight, bounds.bottom)
      const centerX = (visibleLeft + visibleRight) / 2
      const centerY = (visibleTop + visibleBottom) / 2
      const hit = document.elementFromPoint(centerX, centerY)
      const unobscured = Boolean(
        hit && (hit === active || active.contains(hit) || hit.contains(active))
      )

      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.bottom <= 0 ||
        bounds.top >= window.innerHeight ||
        bounds.right <= 0 ||
        bounds.left >= window.innerWidth
      ) {
        return {
          code: "focus_outside_viewport",
          label: active.getAttribute("aria-label") ?? active.textContent,
        }
      }
      if (!focusVisible || !hasIndicator) {
        return {
          code: "focus_not_visible",
          focusVisible,
          hasIndicator,
          label: active.getAttribute("aria-label") ?? active.textContent,
        }
      }
      if (!unobscured) {
        return {
          code: "focus_obscured",
          label: active.getAttribute("aria-label") ?? active.textContent,
        }
      }
      return null
    })
    if (finding?.code === "focus_boundary") {
      if (auditedElements === 0) {
        findings.push({ code: "focus_missing", index })
      }
      break
    }
    auditedElements += 1
    if (finding) {
      findings.push({ ...finding, index })
    }
  }
  return findings
}

const collectCustomFindings = async (
  page: Page,
  accessibilityRoot?: string
): Promise<unknown[]> =>
  page.evaluate((rootSelector) => {
    const findings: unknown[] = []
    const selectedRoot = rootSelector
      ? document.querySelector<HTMLElement>(rootSelector)
      : null
    const queryRoot: Document | HTMLElement = selectedRoot ?? document
    const visible = (element: HTMLElement): boolean => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      )
    }

    const viewportWidth = selectedRoot?.clientWidth ?? window.innerWidth
    const documentWidth = selectedRoot
      ? selectedRoot.scrollWidth
      : document.documentElement.scrollWidth
    const bodyWidth = selectedRoot
      ? selectedRoot.scrollWidth
      : document.body.scrollWidth
    if (documentWidth > viewportWidth + 1 || bodyWidth > viewportWidth + 1) {
      findings.push({
        code: "horizontal_overflow",
        viewport: viewportWidth,
        document: documentWidth,
        body: bodyWidth,
      })
    }

    for (const element of queryRoot.querySelectorAll<HTMLElement>(
      "[tabindex]"
    )) {
      if (element.tabIndex > 0) {
        findings.push({ code: "positive_tabindex", html: element.outerHTML })
      }
    }

    for (const element of queryRoot.querySelectorAll<HTMLElement>(
      "[aria-controls]"
    )) {
      if (!visible(element)) {
        continue
      }
      const ids = element.getAttribute("aria-controls")?.split(/\s+/) ?? []
      for (const id of ids) {
        if (id && !document.getElementById(id)) {
          findings.push({
            code: "dangling_aria_controls",
            id,
            html: element.outerHTML,
          })
        }
      }
    }

    const targetSelector = [
      "button:not(:disabled)",
      "a[href]",
      "input:not([type=hidden]):not(:disabled)",
      "select:not(:disabled)",
      "textarea:not(:disabled)",
      "[role=button]:not([aria-disabled=true])",
      "[role=radio]:not([aria-disabled=true])",
      "[role=checkbox]:not([aria-disabled=true])",
      "[role=switch]:not([aria-disabled=true])",
    ].join(",")
    for (const element of queryRoot.querySelectorAll<HTMLElement>(
      targetSelector
    )) {
      if (!visible(element) || element.closest("[aria-hidden=true]")) {
        continue
      }
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      const inlineLink =
        element.tagName === "A" &&
        style.display === "inline" &&
        Boolean(element.closest("p, li, dd, dt"))
      if (!inlineLink && (bounds.width < 24 || bounds.height < 24)) {
        findings.push({
          code: "undersized_target",
          width: Math.round(bounds.width * 100) / 100,
          height: Math.round(bounds.height * 100) / 100,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().replaceAll(/\s+/g, " ").slice(0, 80),
        })
      }
    }

    for (const animation of selectedRoot
      ? selectedRoot.getAnimations({ subtree: true })
      : document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming()
      if (
        animation.playState === "running" &&
        timing &&
        Number(timing.activeDuration) > 0
      ) {
        findings.push({
          code: "motion_not_reduced",
          duration: timing.activeDuration,
        })
      }
    }

    return findings
  }, accessibilityRoot)

const formatAxeFindings = (
  findings: Array<{
    id: string
    help: string
    impact?: string | null
    nodes: unknown[]
  }>
): string =>
  findings
    .map(
      (finding) =>
        `${finding.id} (${finding.impact ?? "review"}): ${finding.help}; ` +
        `${finding.nodes.length} node(s)`
    )
    .join("\n")

const auditPage = async (
  page: Page,
  capture: RuntimeCapture,
  screenshotName: string,
  options?: { accessibilityRoot?: string }
): Promise<void> => {
  await expect(page.locator("#main-content")).toBeVisible()
  await expect(page.locator("#__next_error__")).toHaveCount(0)
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {})

  await page.screenshot({
    path: path.join(screenshotDirectory, `${screenshotName}.png`),
    fullPage: true,
  })

  const axeBuilder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ])
  if (options?.accessibilityRoot) {
    // Radix makes the document behind a modal inert. Scope the scan to the
    // active accessibility tree so an overlay is not mistaken for obscured
    // background content.
    axeBuilder.include(options.accessibilityRoot)
  }
  const axe = await axeBuilder.analyze()
  expect(axe.violations, formatAxeFindings(axe.violations)).toEqual([])
  expect(axe.incomplete, formatAxeFindings(axe.incomplete)).toEqual([])

  const customFindings = await collectCustomFindings(
    page,
    options?.accessibilityRoot
  )
  expect(customFindings).toEqual([])
  expect(await auditKeyboardFocus(page)).toEqual([])
  expect(capture.consoleErrors).toEqual([])
  expect(capture.failedRequests).toEqual([])
  expect(capture.failedResponses).toEqual([])
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true })
})

const staticCases = [
  { name: "home-desktop", route: "/", width: 1440, height: 900 },
  { name: "catalog-wide", route: "/catalog", width: 1920, height: 1080 },
  {
    name: "product-desktop",
    route: "/music-release/pathologist-pathological-decomposition",
    width: 1440,
    height: 900,
  },
  { name: "news-reflow", route: "/news", width: 320, height: 900 },
  { name: "terms-reflow", route: "/terms", width: 320, height: 900 },
] as const

for (const current of staticCases) {
  test(`${current.name} passes launch acceptance`, async ({ page }) => {
    const capture = startRuntimeCapture(page)
    if (current.route === "/catalog") {
      await installCatalog(page)
    }
    await page.setViewportSize({ width: current.width, height: current.height })
    const response = await page.goto(current.route, {
      waitUntil: "domcontentloaded",
    })
    expect(response?.status()).toBeLessThan(400)
    await rejectNonEssential(page)
    if (current.route === "/catalog") {
      await expect(
        page
          .getByRole("heading", { name: "Pathological Decomposition" })
          .first()
      ).toBeVisible()
    }
    if (current.route.startsWith("/music-release/")) {
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Pathological Decomposition",
        })
      ).toBeVisible()
    }
    await auditPage(page, capture, current.name)
  })
}

test("populated cart remains accessible at 320 CSS pixels", async ({
  page,
}) => {
  const capture = startRuntimeCapture(page)
  await installPopulatedCart(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto("/cart", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await expect(
    page.getByRole("heading", { name: "Shopping cart" })
  ).toBeVisible()
  await expect(
    page.getByRole("dialog", { name: "Shopping cart" })
  ).toBeVisible()
  await auditPage(page, capture, "cart-populated-reflow", {
    accessibilityRoot: '[role="dialog"]',
  })
})

test("empty checkout defers Stripe until payment is required", async ({
  page,
}) => {
  const capture = startRuntimeCapture(page)
  const stripeRequests: string[] = []
  page.on("request", (request) => {
    const hostname = new URL(request.url()).hostname
    if (hostname === "js.stripe.com" || hostname.endsWith(".stripe.com")) {
      stripeRequests.push(hostname)
    }
  })

  await page.setViewportSize({ width: 412, height: 900 })
  await page.goto("/checkout", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await expect(
    page.getByRole("heading", { name: "Your cart is empty" })
  ).toBeVisible()
  expect(stripeRequests).toEqual([])
  await auditPage(page, capture, "checkout-empty-no-stripe")
})

test("checkout validation summary is focused and accessible", async ({
  page,
}) => {
  const capture = startRuntimeCapture(page)
  await installCheckout(page, "validation")
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto("/checkout", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await page.getByRole("button", { name: "Continue to delivery" }).click()
  const email = page.getByLabel("Email address")
  await expect(email).toBeFocused()
  await email.fill("buyer@example.test")
  await page.getByRole("button", { name: "Continue to delivery" }).click()
  await page
    .getByRole("button", { name: "Continue to delivery method" })
    .click()
  await expect(
    page.getByRole("alert", { name: "Check your delivery address" })
  ).toBeFocused()
  await auditPage(page, capture, "checkout-validation-reflow")
})

test("free checkout discloses the exact submit contract", async ({ page }) => {
  const capture = startRuntimeCapture(page)
  await installCheckout(page, "free-ready")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/checkout", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  const submit = page.getByRole("button", { name: "Place free order" })
  await expect(submit).toHaveAccessibleDescription(
    /Submitting places this order with \$0\.00 due now/
  )
  await expect(
    page
      .getByRole("region", { name: "Payment" })
      .getByRole("link", { name: "Privacy" })
  ).toBeVisible()
  await auditPage(page, capture, "checkout-free-disclosure")
})

test("checkout confirmation remains accessible", async ({ page }) => {
  const capture = startRuntimeCapture(page)
  await installConfirmation(page)
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto("/checkout/confirmation", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible()
  await auditPage(page, capture, "checkout-confirmation")
})

test("checkout recovery respects reduced motion", async ({ page }) => {
  const capture = startRuntimeCapture(page)
  await installRecovery(page)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto("/checkout/recover", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await expect(
    page.getByRole("heading", { name: "Confirming your order" })
  ).toBeVisible()
  await auditPage(page, capture, "checkout-recovery")
})

test("privacy validation is focused and actionable", async ({ page }) => {
  const capture = startRuntimeCapture(page)
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto("/privacy", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await page.getByRole("button", { name: "Submit privacy request" }).click()
  await expect(
    page.getByRole("alert", { name: "Check your privacy request" })
  ).toBeFocused()
  await auditPage(page, capture, "privacy-validation")
})

test("privacy success announces a non-PII reference", async ({ page }) => {
  const capture = startRuntimeCapture(page)
  const requestId = "8f42db79-1539-47f2-a0d7-2bf0d620bc88"
  await page.route("**/api/privacy-request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, requestId }),
    })
  })
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto("/privacy", { waitUntil: "domcontentloaded" })
  await rejectNonEssential(page)
  await page.getByLabel("Name").fill("Privacy Customer")
  await page.getByLabel("Email").fill("privacy@example.test")
  await page
    .getByLabel("Details")
    .fill("Please provide a copy of the personal data for this account.")
  await page.getByRole("button", { name: "Submit privacy request" }).click()
  const status = page.getByRole("status")
  await expect(status).toBeFocused()
  await expect(status).toContainText(requestId)
  await auditPage(page, capture, "privacy-success")
})

test("optional storage and Bandcamp remain consent controlled", async ({
  page,
  context,
}) => {
  const capture = startRuntimeCapture(page)
  const externalRequests: string[] = []
  const telemetryRequests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.origin !== "http://127.0.0.1:3000") {
      externalRequests.push(url.hostname)
    }
    if (url.pathname === "/api/telemetry/browser") {
      telemetryRequests.push(request.method())
    }
  })

  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto("/contact", { waitUntil: "networkidle" })
  await expect(
    page.getByRole("complementary", { name: "Cookie consent" })
  ).toBeVisible()
  await expect(page.getByTitle(/Featured Remorseless Records/)).toHaveCount(0)
  expect(telemetryRequests).toEqual([])
  expect(externalRequests).toEqual([])

  const cookieNames = (await context.cookies()).map((cookie) => cookie.name)
  expect(cookieNames.every((name) => name === "rr_cart_v1")).toBe(true)
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }))
  expect(storage.local.every((key) => key === "RR_PUBLIC_QUERY_CACHE_V2")).toBe(
    true
  )
  expect(storage.session).toEqual([])

  await page.getByRole("button", { name: "Accept all" }).click()
  await expect(page.getByTitle(/Featured Remorseless Records/)).toBeVisible()
  expect((await context.cookies()).map((cookie) => cookie.name)).toContain(
    "rr_cookie_preferences"
  )

  await page.goto("/cookies", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Reject non-essential" }).click()
  await page.goto("/contact", { waitUntil: "domcontentloaded" })
  await expect(page.getByTitle(/Featured Remorseless Records/)).toHaveCount(0)
  await auditPage(page, capture, "cookie-consent-revoked")
})
