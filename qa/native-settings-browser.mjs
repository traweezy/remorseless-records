import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertNativeSettingsControl,
  closeSettingsResources,
  createNativeSettingsNavigationIdle,
  settleNativeSettingsTooltips,
  startNativeSettingsLoopbackProxy,
  validateSettingsBrowserRoots,
} from "./lib/native-settings-loopback-proxy.mjs"

const require = createRequire(new URL("../package.json", import.meta.url))
const puppeteer = require("puppeteer")
const { AxePuppeteer } = require("@axe-core/puppeteer")
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const text = (value) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
const nativeRows = (value) => {
  assert.ok(Array.isArray(value), "Native Settings rows must be an array")
  assert.ok(
    value.every((row) => row && typeof row === "object" && !Array.isArray(row)),
    "Native Settings row is malformed"
  )
  return value
}
const providerLabel = (id) => {
  const [, name, type] = id.split("_")
  assert.ok(name, "Native provider identifier is malformed")
  return (
    name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") + (type ? ` (${type.toUpperCase()})` : "")
  )
}
const fileHashes = async (root) => {
  const result = {}
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name)
      assert.notEqual(
        entry.name,
        "Default",
        "Default is excluded before inventory descent"
      )
      assert.ok(
        !entry.isSymbolicLink(),
        "Fixture Admin artifacts cannot be symlinks"
      )
      if (entry.isDirectory()) await walk(filename)
      else if (entry.isFile())
        result[relative(root, filename)] = digest(await readFile(filename))
    }
  }
  await walk(root)
  assert.ok(
    result["index.html"] && Object.keys(result).length > 100,
    "A real compiled Admin bundle is required"
  )
  return result
}

const clickText = async (
  page,
  label,
  selectors = "button,a,[role=menuitem],[role=option]"
) => {
  const handle = await page.evaluateHandle(
    (expected, query) => {
      for (const node of document.querySelectorAll(query)) {
        const rect = node.getBoundingClientRect()
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
        )
          return node
      }
      return null
    },
    label,
    selectors
  )
  try {
    const element = handle.asElement()
    if (!element) throw new Error(`Native UI control not found: ${label}`)
    await element.click()
  } finally {
    await handle.dispose()
  }
}

const field = async (page, label) => {
  const handle = await page.evaluateHandle((expected) => {
    const labels = [...document.querySelectorAll("label")]
    const match = labels.find(
      (node) =>
        (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
    )
    const target = match?.htmlFor
      ? document.getElementById(match.htmlFor)
      : null
    return target
  }, label)
  const element = handle.asElement()
  assert.ok(element, `Native field not found: ${label}`)
  return element
}

const fill = async (page, label, value) => {
  const control = await field(page, label)
  try {
    await control.click()
    await page.keyboard.down("Control")
    try {
      await page.keyboard.press("KeyA")
    } finally {
      await page.keyboard.up("Control")
    }
    await page.keyboard.press("Backspace")
    await control.type(value)
    const typed = await page.waitForFunction(
      (node, expected) =>
        node.isConnected &&
        document.activeElement === node &&
        node.value === expected,
      { timeout: 2000, polling: "raf" },
      control,
      value
    )
    try {
      assert.equal(await typed.jsonValue(), true)
    } finally {
      await typed.dispose()
    }
  } finally {
    await control.dispose()
  }
}

const choose = async (page, label, option) => {
  const control = await field(page, label)
  try {
    await control.click()
    const tag = await control.evaluate((node) => node.tagName)
    if (tag === "INPUT") await control.type(option)
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('[role="option"]')].some(
          (node) =>
            (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
        ),
      {},
      option
    )
    await clickText(page, option, '[role="option"]')
  } finally {
    await control.dispose()
  }
}

const waitRoute = (page, path) =>
  page.waitForFunction(
    (expected) =>
      location.pathname === expected &&
      !document.querySelector('[role="dialog"]'),
    { timeout: 15_000 },
    path
  )

const rowControl = async (page, label, selector = '[role="checkbox"]') => {
  await page.waitForFunction(
    (expected) =>
      [...document.querySelectorAll("tr")].some((node) =>
        node.textContent?.includes(expected)
      ),
    {},
    label
  )
  const handle = await page.evaluateHandle(
    (expected, target) => {
      const row = [...document.querySelectorAll("tr")].find((node) =>
        node.textContent?.includes(expected)
      )
      return row?.querySelector(target)
    },
    label,
    selector
  )
  assert.ok(handle.asElement(), `Native row control missing: ${label}`)
  return handle.asElement()
}

const nativeButton = async (page, label) => {
  const handle = await page.evaluateHandle(
    (expected) =>
      [...document.querySelectorAll("main button")].find((node) => {
        const rect = node.getBoundingClientRect()
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
        )
      }),
    label
  )
  assert.ok(handle.asElement(), `Native button missing: ${label}`)
  return handle.asElement()
}

const assertInteractiveControl = async (control) => {
  return assertNativeSettingsControl(control, {
    prepare: () => control.scrollIntoView(),
  })
}

// Read-only DOM projection: focus and scrolling below use real browser keys.
export const captureNativeSettingsScroller = (node) => {
  const style = getComputedStyle(node)
  const rect = node.getBoundingClientRect()
  return {
    tag: node.tagName,
    tabIndex: node.tabIndex,
    focused: document.activeElement === node,
    tables: node.querySelectorAll("table").length,
    visible:
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      style.display !== "none" &&
      style.visibility === "visible" &&
      Number(style.opacity) > 0 &&
      !node.closest('[inert],[aria-hidden="true"]'),
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    cursor: style.cursor,
    clientWidth: node.clientWidth,
    clientHeight: node.clientHeight,
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
    scrollLeft: node.scrollLeft,
    scrollTop: node.scrollTop,
  }
}

export const proveNativeSettingsPolicyScroller = async (page, mode) => {
  const selector = "main div.overscroll-auto:has(table)"
  const handles = await page.$$(selector)
  const evidence = { selector, tabSteps: 0, movements: [] }
  try {
    assert.equal(
      handles.length,
      1,
      "Policy detail must have one native scroller"
    )
    const scroller = handles[0]
    const initial = await scroller.evaluate(captureNativeSettingsScroller)
    evidence.initial = initial
    assert.equal(initial.tag, "DIV")
    assert.equal(initial.tables, 1)
    assert.equal(
      initial.tabIndex,
      0,
      "Native scroller must be in the Tab order"
    )
    assert.equal(initial.visible, true, "Native scroller must be rendered")
    for (const field of ["overflowX", "overflowY"])
      assert.ok(["auto", "scroll"].includes(initial[field]))
    for (const field of [
      "clientWidth",
      "clientHeight",
      "scrollWidth",
      "scrollHeight",
      "scrollLeft",
      "scrollTop",
    ])
      assert.ok(Number.isFinite(initial[field]) && initial[field] >= 0)
    const deadline = Date.now() + 5000
    let focused
    while (evidence.tabSteps < 64 && Date.now() < deadline) {
      await page.keyboard.press("Tab")
      evidence.tabSteps += 1
      focused = await scroller.evaluate(captureNativeSettingsScroller)
      if (focused.focused) break
    }
    evidence.focused = focused
    assert.equal(
      focused?.focused,
      true,
      "Real Tab must focus the native scroller"
    )
    const horizontalOverflow = focused.scrollWidth > focused.clientWidth + 1
    const verticalOverflow = focused.scrollHeight > focused.clientHeight + 1
    evidence.horizontalOverflow = horizontalOverflow
    evidence.verticalOverflow = verticalOverflow
    if (mode.startsWith("phone"))
      assert.ok(
        horizontalOverflow || verticalOverflow,
        "Phone Policy fixture must exercise actual native table overflow"
      )
    for (const [overflow, key, axis] of [
      [horizontalOverflow, "ArrowRight", "scrollLeft"],
      [verticalOverflow, "ArrowDown", "scrollTop"],
    ]) {
      if (!overflow) continue
      const before = await scroller.evaluate(captureNativeSettingsScroller)
      assert.equal(before.focused, true)
      const movement = { key, axis, before: before[axis] }
      evidence.movements.push(movement)
      await page.keyboard.press(key)
      await page.waitForFunction(
        (node, field, start) =>
          document.activeElement === node && node[field] > start,
        { timeout: 2000 },
        scroller,
        axis,
        before[axis]
      )
      const after = await scroller.evaluate(captureNativeSettingsScroller)
      movement.after = after[axis]
      movement.focused = after.focused
      assert.equal(after.focused, true)
      assert.ok(
        after[axis] > before[axis],
        "Real arrow key must scroll native content"
      )
    }
    evidence.final = await scroller.evaluate(captureNativeSettingsScroller)
    return evidence
  } catch (problem) {
    problem.nativeScrollerProof = evidence
    throw problem
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
}

// Two owned native creation flows use their actual dialog submit control.
const submitNativeDialog = async (page, label, settle) => {
  const dialogs = await page.$$('[role="dialog"][data-state="open"]')
  const buttons = []
  const proof = {
    label,
    activeDialogCount: 0,
    matchingSubmitCount: 0,
    activationAttempts: 0,
    activationResolved: false,
    routeSettled: false,
  }
  try {
    const active = []
    for (const dialog of dialogs) {
      const scope = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          connected: node.isConnected,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
          hiddenAncestor: !!node.closest('[aria-hidden="true"], [inert]'),
          role: node.getAttribute("role"),
          state: node.getAttribute("data-state"),
        }
      })
      if (scope.connected && scope.visible && !scope.hiddenAncestor)
        active.push({ dialog, scope })
    }
    proof.activeDialogCount = active.length
    assert.equal(active.length, 1, "Native submit requires one active dialog")
    proof.dialog = active[0].scope
    buttons.push(...(await active[0].dialog.$$('button[type="submit"]')))
    const matches = []
    for (const button of buttons) {
      if (
        await button.evaluate((node, expected) => {
          const rect = node.getBoundingClientRect()
          return (
            node.isConnected &&
            rect.width > 0 &&
            rect.height > 0 &&
            (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
          )
        }, label)
      )
        matches.push(button)
    }
    proof.matchingSubmitCount = matches.length
    assert.equal(matches.length, 1, "Native dialog submit must be unambiguous")
    proof.control = await assertInteractiveControl(matches[0])
    assert.equal(proof.control.type, "submit")
    proof.activationAttempts = 1
    await matches[0].click()
    proof.activationResolved = true
    await settle()
    proof.routeSettled = true
    return proof
  } catch (problem) {
    problem.nativeDialogSubmitProof = proof
    throw problem
  } finally {
    await Promise.all(
      [...buttons, ...dialogs].map((handle) => handle.dispose())
    )
  }
}

const observeNativeActionMenuClosure = async (handle) =>
  handle.evaluate(
    (trigger) =>
      new Promise((resolve) => {
        const started = performance.now(),
          timeoutMs = 2000,
          sampleLimit = 128,
          samples = []
        let finished = false,
          frame,
          timer
        const finish = (passed, reason) => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          if (frame !== undefined) cancelAnimationFrame(frame)
          const elapsedMs = performance.now() - started
          if (passed && elapsedMs >= timeoutMs) {
            passed = false
            reason = "deadline"
          }
          resolve({
            passed,
            reason,
            elapsedMs,
            timeoutMs,
            sampleLimit,
            sampleCount: samples.length,
            samples,
          })
        }
        const sample = () => {
          if (finished) return
          const elapsedMs = performance.now() - started
          if (elapsedMs >= timeoutMs) return finish(false, "deadline")
          if (samples.length >= sampleLimit)
            return finish(false, "sample-limit")
          const observation = {
            elapsedMs,
            originalTriggerConnected: trigger.isConnected,
            menuUnmounted: !document.querySelector('[role="menu"]'),
            originalTriggerFocused: document.activeElement === trigger,
          }
          samples.push(observation)
          if (
            observation.originalTriggerConnected &&
            observation.menuUnmounted &&
            observation.originalTriggerFocused
          )
            return finish(true, "native-closed-and-focus-returned")
          if (samples.length >= sampleLimit)
            return finish(false, "sample-limit")
          frame = requestAnimationFrame(sample)
        }
        timer = setTimeout(() => finish(false, "deadline"), timeoutMs)
        sample()
      })
  )

const openActions = async (page, label, row = false) => {
  const handle = row
    ? await rowControl(page, label, 'button[aria-label="Open actions"]')
    : (
        await page.evaluateHandle((expected) => {
          const nodes = [
            ...document.querySelectorAll("h1,h2,h3,p,span"),
          ].filter(
            (node) =>
              node.textContent?.trim() === expected &&
              node.getBoundingClientRect().width > 0
          )
          for (const node of nodes) {
            let scope = node.parentElement
            for (
              let depth = 0;
              scope && depth < 6;
              depth += 1, scope = scope.parentElement
            ) {
              const target = [
                ...scope.querySelectorAll('button[aria-label="Open actions"]'),
              ].find((button) => button.getBoundingClientRect().width > 0)
              if (target) return target
            }
          }
          return null
        }, label)
      ).asElement()
  assert.ok(handle, `Native action menu missing: ${label}`)
  let menuClosure
  try {
    const evidence = await assertInteractiveControl(handle)
    assert.equal(
      evidence.type,
      "button",
      "Native action menu must not submit its surrounding form"
    )
    await handle.focus()
    await page.keyboard.press("Enter")
    await page.waitForSelector('[role="menu"]')
    await page.keyboard.press("Escape")
    // Native exit Presence restores trigger focus on unmount. Observe that
    // prerequisite instead of checking before the close animation completes.
    menuClosure = await observeNativeActionMenuClosure(handle)
    assert.equal(
      menuClosure.passed,
      true,
      "Native menu Escape must unmount and restore its original trigger focus"
    )
    await page.keyboard.press("Enter")
    await page.waitForSelector('[role="menu"]')
    return {
      ...evidence,
      keyboardOpen: true,
      escapeFocusReturn: true,
      menuClosure,
    }
  } catch (problem) {
    if (menuClosure) problem.nativeMenuClosureProof = menuClosure
    throw problem
  } finally {
    await handle.dispose()
  }
}

const confirmDialog = async (page, action, verification) => {
  const dialog = await page.waitForSelector('[role="alertdialog"]')
  let input
  let cancel
  let actionControl
  try {
    cancel = (
      await dialog.evaluateHandle((node) => {
        const buttons = [...node.querySelectorAll("button")].filter(
          (button) =>
            button.textContent?.trim() === "Cancel" &&
            button.getBoundingClientRect().width > 0
        )
        return buttons.length === 1 ? buttons[0] : null
      })
    ).asElement()
    assert.ok(cancel, "Native prompt must expose its original Cancel button")
    input = await dialog.$("input#verificationText")
    if (verification !== undefined)
      assert.ok(input, "Native destructive dialog must require verification")
    const readiness = await dialog.evaluate(
      (node, nativeCancel, nativeInput) =>
        new Promise((resolve) => {
          const started = performance.now()
          const samples = []
          let previous
          let quietStarted
          let frame
          let timer
          const finish = (passed, reason) => {
            clearTimeout(timer)
            cancelAnimationFrame(frame)
            resolve({ passed, reason, samples, changedNativeUi: false })
          }
          const sample = () => {
            const elapsedMs = performance.now() - started
            const rect = node.getBoundingClientRect()
            const style = getComputedStyle(node)
            const animations = node
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState !== "finished")
            const observation = {
              elapsedMs,
              connected: node.isConnected,
              menuAbsent: !document.querySelector('[role="menu"]'),
              focus:
                document.activeElement === nativeCancel
                  ? "cancel"
                  : nativeInput && document.activeElement === nativeInput
                    ? "verification"
                    : "other",
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              opacity: Number(style.opacity),
              visibility: style.visibility,
              transform: style.transform,
              activeAnimations: animations.length,
            }
            samples.push(observation)
            const { elapsedMs: _elapsedMs, ...stable } = observation
            const signature = JSON.stringify(stable)
            const ready =
              observation.connected &&
              node.getAttribute("role") === "alertdialog" &&
              nativeCancel.isConnected &&
              node.contains(nativeCancel) &&
              (!nativeInput ||
                (nativeInput.isConnected && node.contains(nativeInput))) &&
              observation.menuAbsent &&
              ["cancel", "verification"].includes(observation.focus) &&
              Object.values(observation.rect).every(Number.isFinite) &&
              rect.width > 0 &&
              rect.height > 0 &&
              observation.opacity === 1 &&
              observation.visibility === "visible" &&
              observation.activeAnimations === 0
            if (!ready || signature !== previous)
              quietStarted = ready ? performance.now() : undefined
            previous = signature
            if (
              ready &&
              quietStarted !== undefined &&
              performance.now() - quietStarted >= 100
            )
              return finish(true, "native-prompt-paint-and-focus-settled")
            if (samples.length >= 128) return finish(false, "sample-limit")
            if (elapsedMs >= 2000) return finish(false, "deadline")
            frame = requestAnimationFrame(sample)
          }
          timer = setTimeout(() => finish(false, "deadline"), 2000)
          sample()
        }),
      cancel,
      input ?? null
    )
    assert.equal(
      readiness.passed,
      true,
      "Native prompt opening focus and paint must settle"
    )
    if (verification !== undefined) await input.type(verification)
    actionControl = (
      await dialog.evaluateHandle((node, expected) => {
        const buttons = [...node.querySelectorAll("button")].filter(
          (button) =>
            button.textContent?.trim() === expected &&
            button.getBoundingClientRect().width > 0
        )
        return buttons.length === 1 ? buttons[0] : null
      }, action)
    ).asElement()
    assert.ok(
      actionControl,
      "Native prompt must expose exactly one requested action"
    )
    const expectedType =
      verification !== undefined && action !== "Cancel" ? "submit" : "button"
    await page.waitForFunction(
      (nativeDialog, nativeInput, nativeAction, expected, type) =>
        nativeDialog.isConnected &&
        nativeAction.isConnected &&
        nativeDialog.contains(nativeAction) &&
        !nativeAction.disabled &&
        nativeAction.type === type &&
        (!nativeInput ||
          (nativeInput.isConnected && nativeDialog.contains(nativeInput))) &&
        (expected === undefined ||
          (nativeInput &&
            document.activeElement === nativeInput &&
            nativeInput.value === expected)),
      { timeout: 2000, polling: "raf" },
      dialog,
      input ?? null,
      actionControl,
      verification,
      expectedType
    )
    const control = await assertInteractiveControl(actionControl)
    assert.equal(
      control.type,
      expectedType,
      "Native prompt action must retain its form contract"
    )
    await actionControl.click()
    await page.waitForFunction(
      () => !document.querySelector('[role="alertdialog"]')
    )
    return {
      readiness,
      verificationTypedOnce: verification !== undefined,
      exactVerificationValue: verification !== undefined ? true : null,
      verificationInputFocused: verification !== undefined ? true : null,
      control,
      actionActivatedOnce: true,
      nativePromptDismissed: true,
    }
  } finally {
    await Promise.all(
      [input, cancel, actionControl, dialog]
        .filter(Boolean)
        .map((handle) => handle.dispose())
    )
  }
}

// Called only from the owned initialized Settings suite. This does not start a
// Medusa app, build artifacts, export sessions, or borrow a staging login.
export const runNativeSettingsBrowserAcceptance = async ({
  fixture,
  adminRoot,
  artifactRoot,
  mode,
}) => {
  assert.ok(isAbsolute(adminRoot) && isAbsolute(artifactRoot))
  await validateSettingsBrowserRoots({
    adminRoot,
    artifactRoot,
    repositoryRoot: resolve(fileURLToPath(new URL("../", import.meta.url))),
  })
  assert.ok(
    ["desktop-light", "desktop-dark", "phone-light", "phone-dark"].includes(
      mode
    )
  )
  const selectedExecutable =
    process.env.ADMIN_ACCEPTANCE_BROWSER?.trim() ||
    ["/usr/bin/helium", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(
      existsSync
    )
  assert.ok(selectedExecutable, "A native Chromium executable is required")
  const executable = await realpath(selectedExecutable)
  assert.ok(
    (await lstat(executable)).isFile(),
    "Native Chromium must be a regular executable"
  )
  const compiled = await fileHashes(adminRoot)
  const output = resolve(artifactRoot, mode)
  assert.ok(output.startsWith(`${resolve(artifactRoot)}/`))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const existing = await readdir(output)
  assert.equal(
    existing.length,
    0,
    "Native Settings evidence output must be fresh"
  )
  const tableFixtures = await fixture.prepareTableFixtures()
  const nativeOrigin = new URL(fixture.origin)
  nativeOrigin.hostname = "127.0.0.1"
  const policies = await fixture.rbac.listRbacPolicies({}, { take: 1000 })
  const nativeTaxProviders = await fixture.request(
    "GET",
    "/admin/tax-providers"
  )
  const nativePaymentProviders = await fixture.request(
    "GET",
    "/admin/payments/payment-providers"
  )
  assert.equal(nativeTaxProviders.status, 200)
  assert.equal(nativePaymentProviders.status, 200)
  const securityHeaders = {}
  for (const name of [
    "content-security-policy",
    "cross-origin-opener-policy",
    "permissions-policy",
    "referrer-policy",
    "x-content-type-options",
    "x-frame-options",
  ])
    if (typeof nativeTaxProviders.headers[name] === "string")
      securityHeaders[name] = nativeTaxProviders.headers[name]
  assert.ok(
    securityHeaders["content-security-policy"],
    "Actual native global CSP is required for compiled static acceptance"
  )
  const proxy = await startNativeSettingsLoopbackProxy({
    upstreamOrigin: nativeOrigin.origin,
    staticRoot: adminRoot,
    staticHashes: compiled,
    ownedIds: [...fixture.owned, ...policies.map((policy) => policy.id)],
    actors: Object.values(fixture.actors),
    providerIds: [
      ...nativeRows(nativeTaxProviders.data.tax_providers),
      ...nativeRows(nativePaymentProviders.data.payment_providers),
    ].map((provider) => provider.id),
    staticResponseHeaders: securityHeaders,
  })
  let browser
  let page
  let context
  let navigationIdle
  const navigationObservationLimits = { ring: 64, deadlines: 8, pending: 128 }
  const navigationObservations = []
  const navigationDeadlineObservations = []
  let navigationObservationCount = 0
  let navigationDeadlineObservationCount = 0
  let navigationContextOrdinal = 0
  const navigationStages = new Set([
    "run-start",
    "native-load-returned",
    "deadline-timeout",
    "idle-resolved",
    "run-finally",
    "manual-read-only",
  ])
  const navigationResourceTypes = new Set([
    "Document",
    "Stylesheet",
    "Image",
    "Media",
    "Font",
    "Script",
    "TextTrack",
    "XHR",
    "Fetch",
    "Prefetch",
    "EventSource",
    "WebSocket",
    "Manifest",
    "SignedExchange",
    "Ping",
    "CSPViolationReport",
    "Preflight",
    "Other",
  ])
  const navigationMethods = new Set([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "CONNECT",
    "TRACE",
  ])
  const navigationProtocols = new Set([
    "http:",
    "https:",
    "data:",
    "blob:",
    "file:",
    "about:",
    "chrome:",
    "chrome-extension:",
  ])
  const navigationFinite = (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null
  const observeNavigation = (contextOrdinal) => {
    let navigationOrdinal = 0
    return (state) => {
      if (state.stage === "run-start") navigationOrdinal += 1
      const pending = state.activeRequests
        .slice(0, navigationObservationLimits.pending)
        .map((item) => {
          const rawProtocol =
            typeof item.url === "string" && URL.canParse(item.url)
              ? new URL(item.url).protocol
              : null
          return {
            networkRequestIdSha256:
              typeof item.requestId === "string"
                ? digest(item.requestId)
                : null,
            frameIdSha256:
              typeof item.frameId === "string" ? digest(item.frameId) : null,
            urlSha256: typeof item.url === "string" ? digest(item.url) : null,
            resourceType: navigationResourceTypes.has(item.resourceType)
              ? item.resourceType
              : "Other",
            method: navigationMethods.has(item.method) ? item.method : "other",
            protocol: navigationProtocols.has(rawProtocol)
              ? rawProtocol
              : "other",
          }
        })
      const snapshot = {
        ordinal: ++navigationObservationCount,
        contextOrdinal,
        navigationOrdinal,
        navigationPhase:
          navigationOrdinal === 1 ? "initial-goto" : "subsequent-navigation",
        stage: navigationStages.has(state.stage) ? state.stage : "unknown",
        observedAt: navigationFinite(state.observedAt),
        zeroSince: navigationFinite(state.zeroSince),
        busy: state.busy === true,
        disposed: state.disposed === true,
        loadObserved: state.loadObserved === true,
        activeSize: navigationFinite(state.activeSize),
        started: navigationFinite(state.totalStarted),
        finished: navigationFinite(state.totalFinished),
        failed: navigationFinite(state.totalFailed),
        fatalNameSha256:
          typeof state.fatalName === "string" ? digest(state.fatalName) : null,
        pending,
        pendingTruncated:
          state.activeRequests.length > navigationObservationLimits.pending,
      }
      navigationObservations.push(snapshot)
      if (navigationObservations.length > navigationObservationLimits.ring)
        navigationObservations.shift()
      if (state.stage === "deadline-timeout") {
        navigationDeadlineObservationCount += 1
        navigationDeadlineObservations.push(snapshot)
        if (
          navigationDeadlineObservations.length >
          navigationObservationLimits.deadlines
        )
          navigationDeadlineObservations.shift()
      }
    }
  }
  const initialNetworkComparison = []
  let initialInterceptionSettlementObserver = null
  const attachInitialNetworkComparison = (currentPage, contextOrdinal) => {
    const limit = { clients: 8, events: 512 }
    const initiatorStackFrameLimit = 8
    const navigationReasons = new Set([
      "anchorClick",
      "formSubmissionGet",
      "formSubmissionPost",
      "httpHeaderRefresh",
      "initialFrameNavigation",
      "metaTagRefresh",
      "other",
      "pageBlockInterstitial",
      "reload",
      "scriptInitiated",
    ])
    const startedNavigationTypes = new Set([
      "reload",
      "reloadBypassingCache",
      "restore",
      "restoreWithPost",
      "historySameDocument",
      "historyDifferentDocument",
      "sameDocument",
      "differentDocument",
    ])
    const navigationDispositions = new Set([
      "currentTab",
      "newTab",
      "newWindow",
      "download",
    ])
    const initiatorTypes = new Set([
      "parser",
      "script",
      "preload",
      "SignedExchange",
      "preflight",
      "FedCM",
      "other",
    ])
    const responseErrorReasons = new Set([
      "Failed",
      "Aborted",
      "TimedOut",
      "AccessDenied",
      "ConnectionClosed",
      "ConnectionReset",
      "ConnectionRefused",
      "ConnectionAborted",
      "ConnectionFailed",
      "NameNotResolved",
      "InternetDisconnected",
      "AddressUnreachable",
      "BlockedByClient",
      "BlockedByResponse",
    ])
    const interceptionActions = new Set([
      "abort",
      "respond",
      "continue",
      "disabled",
      "none",
      "already-handled",
    ])
    let interceptionObservationErrors = 0
    const clients = new Map()
    const publicRequests = new WeakMap()
    const events = []
    let nextPublicRequestOrdinal = 0
    let eventCount = 0
    let refusedClients = 0
    let stopped = false
    const safeTextHash = (value) =>
      typeof value === "string" ? digest(value) : null
    const safeProtocol = (raw) => {
      const protocol =
        typeof raw === "string" && URL.canParse(raw)
          ? new URL(raw).protocol
          : null
      return navigationProtocols.has(protocol) ? protocol : "other"
    }
    const record = (source, stage, data) => {
      if (stopped) return
      events.push({
        ordinal: ++eventCount,
        observedAt: navigationFinite(performance.now()),
        source,
        stage,
        ...data,
      })
      if (events.length > limit.events) events.shift()
    }
    const primaryMetadata = (event) => ({
      networkRequestIdSha256: safeTextHash(event?.requestId),
      frameIdSha256: safeTextHash(event?.frameId),
      loaderIdSha256: safeTextHash(event?.loaderId),
      protocolTimestamp: navigationFinite(event?.timestamp),
      urlSha256: safeTextHash(event?.request?.url ?? event?.response?.url),
      protocol: safeProtocol(event?.request?.url ?? event?.response?.url),
      method: navigationMethods.has(event?.request?.method)
        ? event.request.method
        : "other",
      resourceType: navigationResourceTypes.has(event?.type)
        ? event.type
        : "Other",
    })
    const safeSourceCoordinate = (value) =>
      Number.isSafeInteger(value) && value >= 0 ? value : null
    const initiatorMetadata = (initiator) => {
      const frames = Array.isArray(initiator?.stack?.callFrames)
        ? initiator.stack.callFrames
        : []
      return {
        initiatorPresent: initiator !== undefined,
        initiatorType: initiatorTypes.has(initiator?.type)
          ? initiator.type
          : "other",
        initiatorUrlSha256: safeTextHash(initiator?.url),
        initiatorLineNumber: safeSourceCoordinate(initiator?.lineNumber),
        initiatorColumnNumber: safeSourceCoordinate(initiator?.columnNumber),
        initiatorRequestIdSha256: safeTextHash(initiator?.requestId),
        initiatorStackAlreadyPresent: Array.isArray(
          initiator?.stack?.callFrames
        ),
        initiatorStackFrames: frames
          .slice(0, initiatorStackFrameLimit)
          .map((frame) => ({
            functionNameSha256: safeTextHash(frame?.functionName),
            scriptIdSha256: safeTextHash(frame?.scriptId),
            urlSha256: safeTextHash(frame?.url),
            lineNumber: safeSourceCoordinate(frame?.lineNumber),
            columnNumber: safeSourceCoordinate(frame?.columnNumber),
          })),
        initiatorStackFramesTruncated: frames.length > initiatorStackFrameLimit,
        initiatorStackParentPresent: initiator?.stack?.parent !== undefined,
      }
    }
    const observePrimary = (client) => {
      if (clients.has(client)) return clients.get(client).ordinal
      if (clients.size >= limit.clients) {
        refusedClients += 1
        return null
      }
      const ordinal = clients.size + 1
      const handlers = [
        [
          "Network.requestWillBeSent",
          (event) =>
            record("primary-CDP", "request-start", {
              clientOrdinal: ordinal,
              ...primaryMetadata(event),
              ...initiatorMetadata(event?.initiator),
              redirectObserved: event?.redirectResponse !== undefined,
            }),
        ],
        [
          "Network.responseReceived",
          (event) =>
            record("primary-CDP", "response-headers", {
              clientOrdinal: ordinal,
              ...primaryMetadata(event),
              status: navigationFinite(event?.response?.status),
              fromDiskCache: event?.response?.fromDiskCache === true,
              fromServiceWorker: event?.response?.fromServiceWorker === true,
            }),
        ],
        [
          "Network.loadingFinished",
          (event) =>
            record("primary-CDP", "body-finished", {
              clientOrdinal: ordinal,
              networkRequestIdSha256: safeTextHash(event?.requestId),
              encodedDataLength: navigationFinite(event?.encodedDataLength),
              protocolTimestamp: navigationFinite(event?.timestamp),
            }),
        ],
        [
          "Network.loadingFailed",
          (event) =>
            record("primary-CDP", "body-failed", {
              clientOrdinal: ordinal,
              networkRequestIdSha256: safeTextHash(event?.requestId),
              canceled: event?.canceled === true,
              protocolTimestamp: navigationFinite(event?.timestamp),
              errorTextSha256: safeTextHash(event?.errorText),
            }),
        ],
        [
          "Network.requestServedFromCache",
          (event) =>
            record("primary-CDP", "served-from-cache", {
              clientOrdinal: ordinal,
              networkRequestIdSha256: safeTextHash(event?.requestId),
            }),
        ],
      ]
      handlers.push(
        [
          "Page.frameStartedNavigating",
          (event) =>
            record("primary-CDP", "frame-navigation-started", {
              clientOrdinal: ordinal,
              frameIdSha256: safeTextHash(event?.frameId),
              loaderIdSha256: safeTextHash(event?.loaderId),
              urlSha256: safeTextHash(event?.url),
              navigationType: startedNavigationTypes.has(event?.navigationType)
                ? event.navigationType
                : "other",
            }),
        ],
        [
          "Page.frameRequestedNavigation",
          (event) =>
            record("primary-CDP", "frame-navigation-requested", {
              clientOrdinal: ordinal,
              frameIdSha256: safeTextHash(event?.frameId),
              urlSha256: safeTextHash(event?.url),
              reason: navigationReasons.has(event?.reason)
                ? event.reason
                : "other",
              disposition: navigationDispositions.has(event?.disposition)
                ? event.disposition
                : "other",
            }),
        ],
        [
          "Page.frameScheduledNavigation",
          (event) =>
            record("primary-CDP", "frame-navigation-scheduled", {
              clientOrdinal: ordinal,
              frameIdSha256: safeTextHash(event?.frameId),
              urlSha256: safeTextHash(event?.url),
              reason: navigationReasons.has(event?.reason)
                ? event.reason
                : "other",
              delaySeconds: navigationFinite(event?.delay),
            }),
        ],
        [
          "Fetch.requestPaused",
          (event) =>
            record("primary-CDP", "request-interception-paused", {
              clientOrdinal: ordinal,
              fetchRequestIdSha256: safeTextHash(event?.requestId),
              networkRequestIdSha256: safeTextHash(event?.networkId),
              redirectedFetchRequestIdSha256: safeTextHash(
                event?.redirectedRequestId
              ),
              frameIdSha256: safeTextHash(event?.frameId),
              urlSha256: safeTextHash(event?.request?.url),
              protocol: safeProtocol(event?.request?.url),
              method: navigationMethods.has(event?.request?.method)
                ? event.request.method
                : "other",
              resourceType: navigationResourceTypes.has(event?.resourceType)
                ? event.resourceType
                : "Other",
              responseStatus: navigationFinite(event?.responseStatusCode),
              responseErrorReason:
                event?.responseErrorReason === undefined
                  ? null
                  : responseErrorReasons.has(event.responseErrorReason)
                    ? event.responseErrorReason
                    : "other",
            }),
        ]
      )
      // The first public request follows the first Page.navigate command.
      // This observer cannot report earlier commands or events.
      const sendOwnDescriptor = Object.getOwnPropertyDescriptor(client, "send")
      const originalSend = client.send
      let observedSend = null
      const sendDescriptorSupported =
        sendOwnDescriptor === undefined ||
        (Object.hasOwn(sendOwnDescriptor, "value") &&
          sendOwnDescriptor.value === originalSend)
      if (typeof originalSend === "function" && sendDescriptorSupported) {
        const delegate = function (...args) {
          const [method, params] = args
          if (method === "Page.navigate" || method === "Page.reload") {
            try {
              record("primary-CDP", "existing-navigation-command-issued", {
                clientOrdinal: ordinal,
                command: method,
                frameIdSha256: safeTextHash(params?.frameId),
                urlSha256: safeTextHash(params?.url),
                ignoreCache:
                  method === "Page.reload" &&
                  typeof params?.ignoreCache === "boolean"
                    ? params.ignoreCache
                    : null,
                argumentCount: args.length,
              })
            } catch {
              interceptionObservationErrors += 1
            }
          }
          return Reflect.apply(originalSend, this, args)
        }
        try {
          Object.defineProperty(client, "send", {
            configurable: sendOwnDescriptor?.configurable ?? true,
            enumerable: sendOwnDescriptor?.enumerable ?? false,
            writable: sendOwnDescriptor?.writable ?? true,
            value: delegate,
          })
          observedSend = delegate
        } catch {
          interceptionObservationErrors += 1
        }
      }
      // These passive listeners and delegation never enable, issue a new
      // command, or detach the Puppeteer-owned client.
      for (const [name, handler] of handlers) client.on(name, handler)
      clients.set(client, {
        ordinal,
        handlers,
        sendOwnDescriptor,
        observedSend,
      })
      record("primary-CDP", "client-observed", {
        clientOrdinal: ordinal,
        detached: client.detached === true,
        earlierEventsUnobserved: true,
        earlierNavigationCommandsUnobserved: true,
        existingNavigationCommandObserverInstalled: observedSend !== null,
      })
      return ordinal
    }
    const publicMetadata = (request) => {
      let ordinal = publicRequests.get(request)
      if (ordinal === undefined) {
        ordinal = ++nextPublicRequestOrdinal
        publicRequests.set(request, ordinal)
      }
      const rawType = request.resourceType()
      const matchedType = [...navigationResourceTypes].find(
        (type) => type.toLowerCase() === rawType
      )
      return {
        publicRequestOrdinal: ordinal,
        clientOrdinal: observePrimary(request.client),
        urlSha256: safeTextHash(request.url()),
        protocol: safeProtocol(request.url()),
        method: navigationMethods.has(request.method())
          ? request.method()
          : "other",
        resourceType: matchedType ?? "Other",
        navigationRequest: request.isNavigationRequest() === true,
      }
    }
    const publicHandlers = [
      [
        "request",
        (request) =>
          record("public-Page", "request-start", publicMetadata(request)),
      ],
      [
        "response",
        (response) =>
          record("public-Page", "response-headers", {
            ...publicMetadata(response.request()),
            status: navigationFinite(response.status()),
          }),
      ],
      [
        "requestfinished",
        (request) =>
          record("public-Page", "body-finished", publicMetadata(request)),
      ],
      [
        "requestfailed",
        (request) =>
          record("public-Page", "body-failed", {
            ...publicMetadata(request),
            errorTextSha256: safeTextHash(request.failure()?.errorText),
          }),
      ],
    ]
    const observeInterceptionSettlement = (
      request,
      command,
      settlement,
      problem
    ) => {
      if (stopped) return
      try {
        const action = request.interceptResolutionState()?.action
        record("public-Page", "interception-command-settled", {
          ...publicMetadata(request),
          command,
          settlement,
          isInterceptResolutionHandled:
            request.isInterceptResolutionHandled() === true,
          resolutionAction: interceptionActions.has(action) ? action : "other",
          errorNameSha256: safeTextHash(problem?.name),
          errorMessageSha256: safeTextHash(problem?.message),
        })
      } catch {
        // Observation must not change the original command's settlement.
        interceptionObservationErrors += 1
      }
    }
    initialInterceptionSettlementObserver = observeInterceptionSettlement
    for (const [name, handler] of publicHandlers) currentPage.on(name, handler)
    return () => {
      if (stopped) return
      record("public-Page", "initial-goto-observation-ended", {
        observedClients: clients.size,
        refusedClients,
      })
      stopped = true
      if (
        initialInterceptionSettlementObserver === observeInterceptionSettlement
      )
        initialInterceptionSettlementObserver = null
      for (const [name, handler] of publicHandlers)
        currentPage.off(name, handler)
      let navigationCommandObserversRestored = true
      for (const [
        client,
        { handlers, sendOwnDescriptor, observedSend },
      ] of clients) {
        for (const [name, handler] of handlers) client.off(name, handler)
        if (observedSend !== null) {
          try {
            if (client.send !== observedSend) {
              navigationCommandObserversRestored = false
              interceptionObservationErrors += 1
            } else if (sendOwnDescriptor) {
              Object.defineProperty(client, "send", sendOwnDescriptor)
            } else {
              delete client.send
            }
          } catch {
            navigationCommandObserversRestored = false
            interceptionObservationErrors += 1
          }
        }
      }
      initialNetworkComparison.push({
        contextOrdinal,
        diagnosticOnly: true,
        limits: limit,
        observedCount: eventCount,
        truncated: eventCount > limit.events,
        refusedClients,
        earlierPrimaryRequestEventsMayBeUnobserved: true,
        earlierPrimaryNavigationCommandsUnobserved: true,
        events,
        passivePrimaryListenersRemoved: true,
        primaryClientCommandsIssued: false,
        existingNavigationCommandsArgumentsThisAndDirectReturnUnchanged: true,
        navigationCommandObserversRestored,
        debuggerDomainEnabledByObserver: false,
        initiatorStackFrameLimit,
        interceptionObservationErrors,
        originalInterceptionCommandsArgumentsAndReturnedHandlerValueUnchanged: true,
        authenticationResponseBodiesRead: false,
        originalReadinessPredicatesAndCountsChanged: false,
        rawUrlPathHeadersAuthenticationAndBodiesExported: false,
      })
    }
  }
  const cases = []
  const deniedRemote = []
  const nativeErrors = []
  const readOnlyControlFindings = []
  let error = null
  const checkpointTimingRows = []
  let checkpointTimingObserved = 0
  const checkpointTimingLimits = { checkpoints: 57, phasesPerCheckpoint: 7 }
  const checkpointTimingPhaseNames = [
    "tooltip",
    "axe",
    "axe-json-serialize-write",
    "screenshot",
    "layout",
    "evidence-hash",
  ]
  const checkpoint = async (name, evidence = {}) => {
    const checkpointStarted = performance.now()
    const timing = {
      ordinal: ++checkpointTimingObserved,
      status: "started",
      activePhase: null,
      totalMs: null,
      phases: [],
      phasesTruncated: false,
    }
    if (checkpointTimingRows.length < checkpointTimingLimits.checkpoints)
      checkpointTimingRows.push(timing)
    const timeCheckpointPhase = async (phase, operation) => {
      const started = performance.now()
      const entry = { phase, status: "started", durationMs: null }
      if (timing.phases.length < checkpointTimingLimits.phasesPerCheckpoint)
        timing.phases.push(entry)
      else timing.phasesTruncated = true
      timing.activePhase = phase
      try {
        const value = await operation()
        entry.status = "completed"
        timing.activePhase = null
        return value
      } catch (problem) {
        entry.status = "failed"
        throw problem
      } finally {
        entry.durationMs = performance.now() - started
      }
    }
    try {
      const png = join(
        output,
        `${String(cases.length + 1).padStart(2, "0")}-${name}.png`
      )
      let tooltipVisuals
      try {
        tooltipVisuals = await timeCheckpointPhase("tooltip", () =>
          settleNativeSettingsTooltips(page)
        )
      } catch (problem) {
        const artifact = png.replace(
          /\.png$/u,
          ".tooltip-stability-failed.json"
        )
        await writeFile(
          artifact,
          `${JSON.stringify({ failed: true, name, error: { name: problem.name, message: problem.message }, samples: problem.tooltipSamples ?? [] }, null, 2)}\n`,
          { mode: 0o600, flag: "wx" }
        )
        throw problem
      }
      const axe = await timeCheckpointPhase("axe", () =>
        new AxePuppeteer(page).analyze()
      )
      const axePath = png.replace(/\.png$/u, ".axe.json")
      await timeCheckpointPhase("axe-json-serialize-write", () =>
        writeFile(axePath, `${JSON.stringify(axe, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        })
      )
      const violations = axe.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact)
      )
      await timeCheckpointPhase("screenshot", () =>
        page.screenshot({
          path: png,
          fullPage: true,
          optimizeForSpeed: true,
        })
      )
      const layout = await timeCheckpointPhase("layout", () =>
        page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          overflow: document.documentElement.scrollWidth > innerWidth,
          invalidImages: [...document.images].filter(
            (image) => image.complete && image.naturalWidth === 0
          ).length,
          activeTag: document.activeElement?.tagName,
          images: [...document.images].map((image) => {
            const style = getComputedStyle(image)
            const source = new URL(image.currentSrc || image.src, location.href)
            const width = image.clientWidth
            const height = image.clientHeight
            return {
              sourceOrigin: source.origin,
              sourcePath: source.pathname,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              width,
              height,
              objectFit: style.objectFit,
              stretched:
                image.complete &&
                image.naturalWidth > 0 &&
                image.naturalHeight > 0 &&
                width > 0 &&
                height > 0 &&
                style.objectFit === "fill" &&
                Math.abs(
                  width / height / (image.naturalWidth / image.naturalHeight) -
                    1
                ) > 0.02,
            }
          }),
        }))
      )
      cases.push({
        name,
        status:
          violations.length ||
          layout.overflow ||
          layout.invalidImages ||
          layout.images.some((image) => image.stretched)
            ? "failed"
            : "passed",
        screenshot: png,
        screenshotSha256: await timeCheckpointPhase("evidence-hash", async () =>
          digest(await readFile(png))
        ),
        tooltipVisuals,
        axeArtifact: axePath,
        axeArtifactSha256: await timeCheckpointPhase(
          "evidence-hash",
          async () => digest(await readFile(axePath))
        ),
        axeAllViolations: axe.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
        axeIncomplete: axe.incomplete.map((finding) => ({
          id: finding.id,
          impact: finding.impact,
          nodes: finding.nodes.length,
        })),
        axeSeriousCritical: violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
        layout,
        ...evidence,
      })
      assert.equal(
        violations.length,
        0,
        `Native Settings Axe failed at ${name}`
      )
      assert.equal(
        layout.overflow,
        false,
        `Native Settings viewport overflow at ${name}`
      )
      assert.equal(
        layout.invalidImages,
        0,
        `Native Settings broken image at ${name}`
      )
      assert.equal(
        layout.images.filter((image) => image.stretched).length,
        0,
        `Native Settings stretched image at ${name}`
      )
      timing.status = "completed"
    } catch (problem) {
      timing.status = "failed"
      throw problem
    } finally {
      timing.totalMs = performance.now() - checkpointStarted
    }
  }
  const navigate = async (path) => {
    await navigationIdle.goto(`${proxy.origin}${path}`)
    await page.waitForSelector("main", { timeout: 15_000 })
  }
  const signIn = async (actor) => {
    await navigationIdle?.dispose()
    navigationIdle = null
    await context?.close()
    context = await browser.createBrowserContext()
    page = await context.newPage()
    navigationIdle = await createNativeSettingsNavigationIdle(
      page,
      observeNavigation(++navigationContextOrdinal)
    )
    await page.setViewport(
      mode.startsWith("phone")
        ? { width: 390, height: 844 }
        : { width: 1600, height: 1000 }
    )
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem("medusa_admin_theme", theme),
      mode.endsWith("dark") ? "dark" : "light"
    )
    await page.setRequestInterception(true)
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (
        url.origin === proxy.origin ||
        ["data:", "blob:"].includes(url.protocol)
      )
        void request.continue().then(
          () =>
            initialInterceptionSettlementObserver?.(
              request,
              "continue",
              "fulfilled"
            ),
          (problem) => {
            initialInterceptionSettlementObserver?.(
              request,
              "continue",
              "rejected",
              problem
            )
            throw problem
          }
        )
      else {
        deniedRemote.push({
          method: request.method(),
          origin: url.origin,
          path: url.pathname,
        })
        void request.abort("blockedbyclient").then(
          () =>
            initialInterceptionSettlementObserver?.(
              request,
              "abort",
              "fulfilled"
            ),
          (problem) => {
            initialInterceptionSettlementObserver?.(
              request,
              "abort",
              "rejected",
              problem
            )
            throw problem
          }
        )
      }
    })
    page.on("pageerror", (problem) =>
      nativeErrors.push({ name: problem.name, message: problem.message })
    )
    // Use native ProtectedRoute's recorded return path instead of Login's
    // default Orders destination, which is outside this Settings transport.
    const stopInitialNetworkComparison = attachInitialNetworkComparison(
      page,
      navigationContextOrdinal
    )
    try {
      await navigationIdle.goto(`${proxy.origin}/app/settings/store`)
    } finally {
      stopInitialNetworkComparison()
    }
    await page.waitForSelector('input[name="email"]', { timeout: 15_000 })
    await page.type('input[name="email"]', actor.email)
    await page.type('input[type="password"]', actor.password)
    await clickText(page, "Continue with Email")
    await page.waitForFunction(() => !location.pathname.endsWith("/login"), {
      timeout: 15_000,
    })
    const me = await page.evaluate(() => window.__sdk.admin.user.me())
    assert.equal(
      me.user.id,
      actor.id,
      "Browser session actor must match persisted synthetic user"
    )
  }
  const assertWrite = (method, path, before, expectedStatus = 200) => {
    const writes = proxy.receipts
      .slice(before)
      .filter(
        (entry) =>
          entry.kind === "native" &&
          entry.method === method &&
          entry.path === path
      )
    assert.equal(
      writes.length,
      1,
      "Native UI must submit exactly one armed write"
    )
    assert.equal(
      writes[0].status,
      expectedStatus,
      "Native UI write must succeed through initialized HTTP"
    )
    return writes[0]
  }
  const waitWrite = async (method, path, before, expectedStatus = 200) => {
    const deadline = Date.now() + 15_000
    while (
      !proxy.receipts
        .slice(before)
        .some(
          (entry) =>
            entry.kind === "native" &&
            entry.method === method &&
            entry.path === path
        ) &&
      Date.now() < deadline
    )
      await new Promise((done) => setTimeout(done, 20))
    return assertWrite(method, path, before, expectedStatus)
  }
  const writeProof = async (entity, id, expected) => {
    fixture.owned.add(id)
    const rows = await fixture.rows(entity, [id], ["*"])
    assert.equal(rows.length, 1)
    for (const [key, value] of Object.entries(expected))
      assert.deepEqual(
        rows[0][key],
        value,
        `Native persisted ${entity}.${key} differs`
      )
    return { entity, id, persistedFields: expected }
  }
  const waitRead = async (path, before, expected) => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const match = proxy.receipts.slice(before).find((entry) => {
        if (
          entry.kind !== "native" ||
          entry.method !== "GET" ||
          entry.path !== path ||
          entry.status !== 200
        )
          return false
        const query = Object.fromEntries(entry.query ?? [])
        return Object.entries(expected).every(
          ([key, value]) => query[key] === value
        )
      })
      if (match) return match
      await new Promise((done) => setTimeout(done, 20))
    }
    throw new Error(`Native table did not issue the required query: ${path}`)
  }
  const renderedTableRows = async (definition, expected) => {
    await page.waitForFunction(
      (labels, tax) => {
        const actual = tax
          ? [...document.querySelectorAll("main a[href]")]
              .map((node) => new URL(node.href).pathname.split("/").at(-1))
              .filter((id) => labels.includes(id))
          : [...document.querySelectorAll("main tbody tr")].map((node) =>
              labels.find((label) => (node.textContent ?? "").includes(label))
            )
        return (
          actual.length === labels.length &&
          actual.every((value, index) => value === labels[index])
        )
      },
      { timeout: 15_000 },
      expected,
      definition.tax === true
    )
    return page.evaluate(
      (labels, tax) =>
        tax
          ? [...document.querySelectorAll("main a[href]")]
              .map((node) => new URL(node.href).pathname.split("/").at(-1))
              .filter((id) => labels.includes(id))
          : [...document.querySelectorAll("main tbody tr")].map((node) =>
              labels.find((label) => (node.textContent ?? "").includes(label))
            ),
      expected,
      definition.tax === true
    )
  }
  const tableDefinitions = [
    {
      name: "users",
      ui: "/app/settings/users",
      api: "/admin/users",
      q: tableFixtures.userSearch,
      order: "email",
      sortLabel: "Email",
      rows: tableFixtures.users,
      label: "email",
    },
    {
      name: "roles",
      ui: "/app/settings/roles",
      api: "/admin/rbac/roles",
      q: tableFixtures.roleSearch,
      order: "name",
      sortLabel: "Name",
      rows: tableFixtures.roles,
      label: "name",
    },
    {
      name: "regions",
      ui: "/app/settings/regions",
      api: "/admin/regions",
      q: tableFixtures.regionSearch,
      order: "name",
      sortLabel: "Name",
      legacy: true,
      rows: tableFixtures.regions,
      label: "name",
    },
    {
      name: "tax-regions",
      ui: "/app/settings/tax-regions",
      api: "/admin/tax-regions",
      order: "country_code",
      tax: true,
      rows: tableFixtures.taxRegions,
      label: "id",
    },
  ]
  const checkNativePagination = async (definition) => {
    const before = proxy.receipts.length
    await navigate(definition.ui)
    let sortMenuClosure = null
    if (!definition.tax) {
      const search = await page.$('main input[type="search"]')
      assert.ok(search, "Reachable native list Search is required")
      await search.type(definition.q)
      await search.dispose()
      await waitRead(definition.api, before, { q: definition.q, limit: "20" })
      const sort = await page.$(
        definition.legacy
          ? 'main button[aria-label="Sort results"]'
          : 'main button[aria-label="Sort"]'
      )
      assert.ok(sort, "Reachable native sorting menu is required")
      try {
        await assertInteractiveControl(sort)
        await sort.focus()
        await page.keyboard.press("Enter")
        await page.waitForSelector('[role="menuitemradio"]')
        await clickText(page, definition.sortLabel, '[role="menuitemradio"]')
        await page.keyboard.press("Escape")
        // Native Radix closes through exit Presence and restores trigger focus
        // on unmount. Observe that prerequisite before scrolling pagination.
        const started = Date.now()
        const closed = await page.waitForFunction(
          (trigger) =>
            trigger.isConnected &&
            !document.querySelector('[role="menu"]') &&
            document.activeElement === trigger,
          { timeout: 2000, polling: "raf" },
          sort
        )
        try {
          assert.equal(await closed.jsonValue(), true)
          sortMenuClosure = {
            elapsedMs: Date.now() - started,
            timeoutMs: 2000,
            menuUnmounted: true,
            originalTriggerConnected: true,
            originalTriggerFocused: true,
            changedNativeUi: false,
          }
        } finally {
          await closed.dispose()
        }
      } finally {
        await sort.dispose()
      }
    }
    const query = {
      limit: "20",
      order: definition.order,
      ...(definition.q ? { q: definition.q } : { parent_id: "null" }),
    }
    const firstRead = await waitRead(definition.api, before, query)
    const ordered = [...definition.rows].sort((a, b) =>
      (definition.tax ? a.countryCode : a[definition.label]).localeCompare(
        definition.tax ? b.countryCode : b[definition.label]
      )
    )
    const expected = ordered.map((row) => row[definition.label])
    assert.equal(expected.length, 21)
    const firstPage = await renderedTableRows(definition, expected.slice(0, 20))
    const next = await nativeButton(page, "Next")
    const nextControl = await assertInteractiveControl(next)
    assert.equal(nextControl.type, "button")
    const beforeNext = proxy.receipts.length
    await next.focus()
    await page.keyboard.press("Enter")
    await next.dispose()
    const secondRead = await waitRead(definition.api, beforeNext, {
      ...query,
      offset: "20",
    })
    const secondPage = await renderedTableRows(definition, expected.slice(20))
    const terminalNext = await nativeButton(page, "Next")
    assert.equal(
      await terminalNext.evaluate((node) => node.disabled),
      true,
      "Next must be disabled on the real final page"
    )
    await terminalNext.dispose()
    const previous = await nativeButton(page, "Prev")
    const previousControl = await assertInteractiveControl(previous)
    const beforePrevious = proxy.receipts.length
    await previous.focus()
    await page.keyboard.press("Enter")
    await previous.dispose()
    // The native Query cache can supply page 1; rendered exact rows, URL offset
    // and the prior real HTTP receipt jointly prove the return without forcing
    // a duplicate GET or replacing native persistence with a UI fixture.
    await page.waitForFunction(
      () =>
        !new URLSearchParams(location.search).get("offset") ||
        new URLSearchParams(location.search).get("offset") === "0"
    )
    const returnedPage = await renderedTableRows(
      definition,
      expected.slice(0, 20)
    )
    const unavailable = await page.evaluate(() => ({
      columnVisibilityButtons: document.querySelectorAll(
        'main button[aria-label="Columns"]'
      ).length,
      listSelectionCheckboxes: document.querySelectorAll(
        'main tbody [role="checkbox"]'
      ).length,
      searchFields: document.querySelectorAll('main input[type="search"]')
        .length,
    }))
    assert.equal(unavailable.columnVisibilityButtons, 0)
    assert.equal(unavailable.listSelectionCheckboxes, 0)
    if (definition.tax) assert.equal(unavailable.searchFields, 0)
    assert.deepEqual(new Set([...firstPage, ...secondPage]), new Set(expected))
    await checkpoint(`${definition.name}-real-native-pagination`, {
      setupProvenance: tableFixtures.setupProvenance,
      fixtureRows: definition.rows,
      pageSize: 20,
      count: 21,
      firstPage,
      secondPage,
      returnedPage,
      firstRead,
      secondRead,
      nextControl,
      previousControl,
      sortMenuClosure,
      nativeReturnReads: proxy.receipts
        .slice(beforePrevious)
        .filter(
          (entry) =>
            entry.kind === "native" &&
            entry.method === "GET" &&
            entry.path === definition.api
        ),
      unavailableControls: unavailable,
      keyboardNextPrevious: true,
    })
  }
  const observeReadOnlyControl = async (name, run) => {
    try {
      await run()
    } catch (problem) {
      const finding = {
        name,
        error: { name: problem.name, message: problem.message },
        ...(problem.nativeControlProof
          ? { nativeControlProof: problem.nativeControlProof }
          : {}),
      }
      readOnlyControlFindings.push(finding)
      // Retain independent actual control failures and continue the bounded
      // read-only audit. Every finding still fails the final acceptance gate.
      try {
        await checkpoint(`${name}-failed`, { controlFinding: finding })
      } catch (checkpointProblem) {
        finding.checkpointError = {
          name: checkpointProblem.name,
          message: checkpointProblem.message,
        }
      } finally {
        if (cases.length) cases.at(-1).status = "failed"
      }
    }
  }
  const checkNativeDateFilter = async (definition) => {
    await navigate(definition.ui)
    const search = await page.$('main input[type="search"]')
    assert.ok(search)
    const beforeSearch = proxy.receipts.length
    await search.type(definition.q)
    await search.dispose()
    await waitRead(definition.api, beforeSearch, {
      q: definition.q,
      limit: "20",
    })
    if (definition.legacy) await clickText(page, "Add filter")
    else {
      const trigger = await page.$('main button[aria-label="Filter"]')
      assert.ok(trigger)
      await assertInteractiveControl(trigger)
      await trigger.focus()
      await page.keyboard.press("Enter")
      await trigger.dispose()
    }
    await page.waitForSelector('[role="menuitem"]')
    await clickText(page, "Created", '[role="menuitem"]')
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (node) => node.textContent?.trim() === "Today"
      )
    )
    const beforeFilter = proxy.receipts.length
    await clickText(page, "Today")
    await page.waitForFunction(() =>
      new URLSearchParams(location.search).has("created_at")
    )
    const selected = await page.evaluate(() =>
      JSON.parse(new URLSearchParams(location.search).get("created_at"))
    )
    assert.ok(
      typeof selected.$gte === "string" &&
        Number.isFinite(Date.parse(selected.$gte))
    )
    await page.keyboard.press("Escape")
    await checkpoint(`${definition.name}-date-filter-selected`, {
      selected,
      nativeControl: "Created / Today",
    })
    const read = await waitRead(definition.api, beforeFilter, {
      q: definition.q,
      "created_at[$gte]": selected.$gte,
    })
    await checkpoint(`${definition.name}-date-filter-native-query`, {
      read,
      selected,
    })
    // New and legacy tables have different native removal controls. Leaving
    // via the native list route resets the URL/cache without writing data.
    await navigate(definition.ui)
    assert.equal(
      await page.evaluate(() =>
        new URLSearchParams(location.search).has("created_at")
      ),
      false
    )
  }
  const checkNativeDescendingSort = async (definition) => {
    await navigate(definition.ui)
    const search = await page.$('main input[type="search"]')
    assert.ok(search)
    const before = proxy.receipts.length
    await search.type(definition.q)
    await search.dispose()
    await waitRead(definition.api, before, { q: definition.q, limit: "20" })
    const trigger = await page.$(
      definition.legacy
        ? 'main button[aria-label="Sort results"]'
        : 'main button[aria-label="Sort"]'
    )
    assert.ok(trigger)
    await trigger.click()
    await trigger.dispose()
    await page.waitForSelector('[role="menuitemradio"]')
    await clickText(page, definition.sortLabel, '[role="menuitemradio"]')
    if (definition.legacy) {
      const direction = await page.evaluateHandle(() =>
        [...document.querySelectorAll('[role="menuitemradio"]')].find((node) =>
          node.textContent?.trim().startsWith("Descending")
        )
      )
      assert.ok(direction.asElement())
      await direction.asElement().click()
      await direction.dispose()
    } else await clickText(page, "Z to A", '[role="menuitemradio"]')
    await page.keyboard.press("Escape")
    const read = await waitRead(definition.api, before, {
      q: definition.q,
      limit: "20",
      order: `-${definition.order}`,
    })
    const ordered = [...definition.rows].sort((a, b) =>
      b[definition.label].localeCompare(a[definition.label])
    )
    const rendered = await renderedTableRows(
      definition,
      ordered.slice(0, 20).map((row) => row[definition.label])
    )
    await checkpoint(`${definition.name}-descending-sort-native-query`, {
      read,
      rendered,
    })
  }
  const checkNativeTaxSort = async () => {
    await navigate("/app/settings/tax-regions")
    const before = proxy.receipts.length
    const trigger = await page.$('main button[aria-label="Sort results"]')
    assert.ok(trigger)
    const control = await assertInteractiveControl(trigger)
    await trigger.focus()
    await page.keyboard.press("Enter")
    await trigger.dispose()
    await page.waitForSelector('[role="menuitemradio"]')
    const options = await page.$$eval('[role="menuitemradio"]', (nodes) =>
      nodes.map((node) => ({
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
        role: node.getAttribute("role"),
      }))
    )
    await checkpoint("tax-regions-sort-menu-native-render", {
      control,
      options,
    })
    assert.ok(
      options.every((option) => option.text.length > 0),
      "Native Tax sort menu has an unnamed option"
    )
    assert.ok(
      options.some((option) => option.text === "Created"),
      "Native Tax sort is missing its Created option"
    )
    await clickText(page, "Created", '[role="menuitemradio"]')
    await page.keyboard.press("Escape")
    const selected = await page.evaluate(() =>
      new URLSearchParams(location.search).get("order")
    )
    assert.equal(selected, "created_at")
    const read = await waitRead("/admin/tax-regions", before, {
      parent_id: "null",
      limit: "20",
      order: "created_at",
    })
    const response = await fixture.request(
      "GET",
      "/admin/tax-regions?parent_id=null&limit=20&order=created_at"
    )
    assert.equal(response.status, 200)
    assert.equal(response.data.count, 21)
    const expected = nativeRows(response.data.tax_regions).map((row) => row.id)
    assert.ok(
      expected.every((id) =>
        tableFixtures.taxRegions.some((row) => row.id === id)
      )
    )
    const rendered = await renderedTableRows(tableDefinitions[3], expected)
    await checkpoint("tax-regions-sort-native-query-and-readback", {
      read,
      selected,
      expected,
      rendered,
    })
  }
  try {
    browser = await puppeteer.launch({
      executablePath: executable,
      headless: true,
      args: ["--disable-dev-shm-usage"],
    })
    await signIn(fixture.actors.owner)
    for (const [name, path] of [
      ["store-initial", "/app/settings/store"],
      ["users-native-table", "/app/settings/users"],
      ["roles-native-table", "/app/settings/roles"],
      ["policies-read-only-table", "/app/settings/policies"],
      ["regions-native-table", "/app/settings/regions"],
      ["tax-regions-native-table", "/app/settings/tax-regions"],
    ]) {
      await navigate(path)
      await checkpoint(name, {
        nativePath: path,
        mutationsSinceStart: proxy.receipts.filter(
          (entry) =>
            entry.kind === "native" && ["POST", "DELETE"].includes(entry.method)
        ).length,
      })
    }
    for (const definition of tableDefinitions)
      await checkNativePagination(definition)
    await navigate("/app/settings/policies")
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll("main button,main [role=menuitem]")].some(
          (node) =>
            /^(Create|Edit|Delete)$/u.test((node.textContent ?? "").trim())
        )
      ),
      false,
      "Native Policies UI is intentionally read-only"
    )
    const readablePolicy = policies.find(
      (policy) => policy.key === "store:read"
    )
    assert.ok(readablePolicy)
    await navigate(`/app/settings/policies/${readablePolicy.id}`)
    const nativeScroller = await proveNativeSettingsPolicyScroller(page, mode)
    await checkpoint("policy-native-read-only-detail", {
      policyId: readablePolicy.id,
      nativeCrudUi: "unavailable-by-installed-route-contract",
      nativeScroller,
    })

    // Native Store form includes the existing supported-currency projection.
    await navigate("/app/settings/store/edit")
    const nativeStore = await page.evaluate(() =>
      window.__sdk.admin.store.list()
    )
    const current = nativeStore.stores[0]
    assert.equal(current.id, fixture.store.id)
    const storeName = `Browser Store ${fixture.tag}`
    await fill(page, "Name", storeName)
    const beforeEnter = proxy.receipts.length
    await page.keyboard.press("Enter")
    assert.equal(
      proxy.receipts
        .slice(beforeEnter)
        .filter((entry) => entry.method === "POST").length,
      0,
      "Plain text-field Enter must not submit"
    )
    const storeBody = {
      name: storeName,
      supported_currencies: current.supported_currencies.map((currency) => ({
        ...currency,
        is_default: currency.is_default,
      })),
      ...(current.default_region_id
        ? { default_region_id: current.default_region_id }
        : {}),
      ...(current.default_sales_channel_id
        ? { default_sales_channel_id: current.default_sales_channel_id }
        : {}),
      ...(current.default_location_id
        ? { default_location_id: current.default_location_id }
        : {}),
    }
    const storePath = `/admin/stores/${current.id}`
    proxy.arm({ method: "POST", path: storePath, body: storeBody })
    const beforeStore = proxy.receipts.length
    await page.keyboard.down("Control")
    await page.keyboard.press("Enter")
    await page.keyboard.up("Control")
    await waitRoute(page, "/app/settings/store")
    const storeWrite = assertWrite("POST", storePath, beforeStore)
    const storeProof = await writeProof("store", current.id, {
      name: storeName,
    })
    await navigationIdle.reload()
    assert.ok(
      text(await page.$eval("main", (node) => node.textContent)).includes(
        storeName
      )
    )
    await checkpoint("store-keyboard-save-native-persistence", {
      write: storeWrite,
      readback: storeProof,
      reloadVerified: true,
    })

    await navigate("/app/settings/store/currencies")
    const currencySearch = await page.$(
      '[role="dialog"] input[placeholder*="Search"]'
    )
    assert.ok(currencySearch, "Native currency search must be available")
    await currencySearch.type("eur")
    await currencySearch.dispose()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="dialog"] tr')].some((row) =>
        row.textContent?.includes("EUR")
      )
    )
    const eurCheckbox = await page.evaluateHandle(() => {
      const row = [...document.querySelectorAll('[role="dialog"] tr')].find(
        (candidate) => candidate.textContent?.includes("EUR")
      )
      return row?.querySelector('[role="checkbox"]')
    })
    assert.ok(eurCheckbox.asElement(), "Native EUR checkbox must exist")
    await eurCheckbox.asElement().click()
    await eurCheckbox.dispose()
    const usdPreferences = await fixture.request(
      "GET",
      "/admin/price-preferences?attribute=currency_code&value=usd"
    )
    assert.equal(usdPreferences.status, 200)
    const preferences = new Map(
      nativeRows(usdPreferences.data.price_preferences).map((preference) => [
        preference.value,
        preference.is_tax_inclusive,
      ])
    )
    const currencyBody = {
      supported_currencies: [
        { currency_code: "eur", is_default: false },
        {
          currency_code: "usd",
          is_default: true,
          ...(preferences.has("usd")
            ? { is_tax_inclusive: preferences.get("usd") }
            : {}),
        },
      ],
    }
    proxy.arm({ method: "POST", path: storePath, body: currencyBody })
    const beforeCurrency = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, "/app/settings/store")
    const currencyWrite = assertWrite("POST", storePath, beforeCurrency)
    const storeCurrencyRows = await fixture.rows(
      "store",
      [current.id],
      [
        "id",
        "supported_currencies.currency_code",
        "supported_currencies.is_default",
      ]
    )
    const codes = nativeRows(storeCurrencyRows[0].supported_currencies)
      .map((currency) => currency.currency_code)
      .sort()
    assert.deepEqual(codes, ["eur", "usd"])
    await checkpoint("store-currency-search-add-native-persistence", {
      write: currencyWrite,
      readback: {
        entity: "store",
        id: current.id,
        supportedCurrencyCodes: codes,
      },
    })

    const currencyState = (
      await page.evaluate(() => window.__sdk.admin.store.list())
    ).stores[0]
    const eurPreferences = await fixture.request(
      "GET",
      "/admin/price-preferences?attribute=currency_code&value=eur"
    )
    const inclusiveBefore = nativeRows(
      eurPreferences.data.price_preferences
    ).find((preference) => preference.value === "eur")?.is_tax_inclusive
    const currencyCursor = await openActions(page, "EUR", true)
    proxy.arm({
      method: "POST",
      path: storePath,
      body: {
        supported_currencies: currencyState.supported_currencies.map(
          (currency) => ({
            ...currency,
            is_tax_inclusive:
              currency.currency_code === "eur" ? !inclusiveBefore : undefined,
          })
        ),
      },
    })
    const beforeInclusive = proxy.receipts.length
    await clickText(
      page,
      inclusiveBefore
        ? "Disable tax inclusive pricing"
        : "Enable tax inclusive pricing",
      '[role="menuitem"]'
    )
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
    const inclusiveDeadline = Date.now() + 15_000
    while (
      !proxy.receipts
        .slice(beforeInclusive)
        .some((entry) => entry.kind === "native" && entry.method === "POST") &&
      Date.now() < inclusiveDeadline
    )
      await new Promise((done) => setTimeout(done, 20))
    const inclusiveRead = await fixture.request(
      "GET",
      "/admin/price-preferences?attribute=currency_code&value=eur"
    )
    assert.equal(
      nativeRows(inclusiveRead.data.price_preferences).find(
        (preference) => preference.value === "eur"
      )?.is_tax_inclusive,
      !inclusiveBefore
    )
    await checkpoint("store-row-tax-inclusive-pointer-native-persistence", {
      control: currencyCursor,
      write: assertWrite("POST", storePath, beforeInclusive),
      readback: { currency: "eur", isTaxInclusive: !inclusiveBefore },
    })

    await navigate("/app/settings/store/edit")
    await choose(page, "Default currency", "EUR")
    const defaultState = (
      await page.evaluate(() => window.__sdk.admin.store.list())
    ).stores[0]
    proxy.arm({
      method: "POST",
      path: storePath,
      body: {
        name: defaultState.name,
        default_region_id: defaultState.default_region_id || undefined,
        default_sales_channel_id:
          defaultState.default_sales_channel_id || undefined,
        default_location_id: defaultState.default_location_id || undefined,
        supported_currencies: defaultState.supported_currencies.map(
          (currency) => ({
            ...currency,
            is_default: currency.currency_code === "eur",
          })
        ),
      },
    })
    const beforeDefault = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, "/app/settings/store")
    const defaultRead = await fixture.rows(
      "store",
      [current.id],
      [
        "id",
        "supported_currencies.currency_code",
        "supported_currencies.is_default",
      ]
    )
    assert.equal(
      nativeRows(defaultRead[0].supported_currencies).find(
        (currency) => currency.is_default
      )?.currency_code,
      "eur"
    )
    await checkpoint("store-default-currency-native-persistence", {
      write: assertWrite("POST", storePath, beforeDefault),
      defaultCurrency: "eur",
    })

    const defaultCurrencyTrigger = await rowControl(
      page,
      "EUR",
      'button[aria-label="Open actions"]'
    )
    let defaultCurrencyMenuClosure
    try {
      await openActions(page, "EUR", true)
      const defaultRemoval = await page.evaluate(() =>
        [...document.querySelectorAll('[role="menuitem"]')]
          .find((node) => node.textContent?.trim() === "Remove")
          ?.getAttribute("aria-disabled")
      )
      assert.equal(
        defaultRemoval,
        "true",
        "Default currency removal must be disabled"
      )
      await page.keyboard.press("Escape")
      defaultCurrencyMenuClosure = await observeNativeActionMenuClosure(
        defaultCurrencyTrigger
      )
      assert.equal(
        defaultCurrencyMenuClosure.passed,
        true,
        "Native menu Escape must unmount and restore its original trigger focus"
      )
    } catch (problem) {
      if (defaultCurrencyMenuClosure)
        problem.nativeMenuClosureProof = defaultCurrencyMenuClosure
      throw problem
    } finally {
      await defaultCurrencyTrigger.dispose()
    }
    await openActions(page, "USD", true)
    await clickText(page, "Remove", '[role="menuitem"]')
    const removeState = (
      await page.evaluate(() => window.__sdk.admin.store.list())
    ).stores[0]
    proxy.arm({
      method: "POST",
      path: storePath,
      body: {
        supported_currencies: removeState.supported_currencies.filter(
          (currency) => currency.currency_code !== "usd"
        ),
      },
    })
    const beforeRemoval = proxy.receipts.length
    await confirmDialog(page, "Remove", "US Dollar")
    const removalWrite = await waitWrite("POST", storePath, beforeRemoval)
    const removalRead = await fixture.request("GET", storePath)
    assert.deepEqual(
      nativeRows(removalRead.data.store.supported_currencies).map(
        (currency) => currency.currency_code
      ),
      ["eur"]
    )
    await checkpoint("store-verified-row-remove-native-persistence", {
      write: removalWrite,
      supportedCurrencyCodes: ["eur"],
      defaultCurrencyMenuClosure,
    })

    await navigate("/app/settings/store/metadata/edit")
    await page.type('input[name="metadata.0.key"]', "owned_audit")
    await page.type('input[name="metadata.0.value"]', "true")
    proxy.arm({
      method: "POST",
      path: storePath,
      body: { metadata: { owned_audit: true } },
    })
    const beforeMetadata = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, "/app/settings/store")
    await checkpoint("store-metadata-type-native-persistence", {
      write: assertWrite("POST", storePath, beforeMetadata),
      readback: await writeProof("store", current.id, {
        metadata: { owned_audit: true },
      }),
    })

    await navigate(`/app/settings/users/${fixture.actors.reader.id}/edit`)
    await fill(page, "First Name", "Browser")
    await fill(page, "Last Name", "Owned")
    const userPath = `/admin/users/${fixture.actors.reader.id}`
    proxy.arm({
      method: "POST",
      path: userPath,
      body: { first_name: "Browser", last_name: "Owned" },
    })
    const beforeUser = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/users/${fixture.actors.reader.id}`)
    const userWrite = assertWrite("POST", userPath, beforeUser)
    await checkpoint("user-name-save-native-persistence", {
      write: userWrite,
      readback: await writeProof("user", fixture.actors.reader.id, {
        first_name: "Browser",
        last_name: "Owned",
        email: fixture.actors.reader.email,
      }),
    })

    await navigate(`/app/settings/roles/${fixture.targetRole.id}/edit`)
    const roleName = `Browser edited role ${fixture.tag}`
    await fill(page, "Name", roleName)
    await fill(page, "Description", "Owned UI edit")
    const rolePath = `/admin/rbac/roles/${fixture.targetRole.id}`
    proxy.arm({
      method: "POST",
      path: rolePath,
      body: { name: roleName, description: "Owned UI edit" },
    })
    const beforeRole = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/roles/${fixture.targetRole.id}`)
    await checkpoint("role-edit-native-persistence", {
      write: assertWrite("POST", rolePath, beforeRole),
      readback: await writeProof("rbac_role", fixture.targetRole.id, {
        name: roleName,
        description: "Owned UI edit",
      }),
    })

    await navigate("/app/settings/roles/create")
    await clickText(page, "Continue")
    assert.ok(
      await page.$('[aria-invalid="true"]'),
      "Empty native Role name must be invalid"
    )
    const createdRoleName = `Browser created role ${fixture.tag}`
    await fill(page, "Name", createdRoleName)
    await clickText(page, "Continue")
    proxy.arm({
      method: "POST",
      path: "/admin/rbac/roles",
      body: { name: createdRoleName, description: null },
      responseEntity: "role",
    })
    const beforeCreate = proxy.receipts.length
    const roleCreateSubmit = await submitNativeDialog(page, "Create", () =>
      page.waitForFunction(
        () =>
          /\/settings\/roles\/role_/u.test(location.pathname) &&
          !document.querySelector('[role="dialog"]')
      )
    )
    const roleCreate = assertWrite("POST", "/admin/rbac/roles", beforeCreate)
    await checkpoint("role-create-native-persistence", {
      submit: roleCreateSubmit,
      write: roleCreate,
      readback: await writeProof("rbac_role", roleCreate.createdId, {
        name: createdRoleName,
        description: null,
      }),
    })

    const rolePolicy = policies.find((policy) => policy.key === "store:read")
    assert.ok(rolePolicy, "Persisted native Store read policy must exist")
    await navigate(`/app/settings/roles/${fixture.targetRole.id}/permissions`)
    const permissionSearch = await page.$(
      '[role="dialog"] input[placeholder*="Search"]'
    )
    assert.ok(permissionSearch)
    await permissionSearch.type("store:read")
    await permissionSearch.dispose()
    const policyCheckbox = await rowControl(page, "store:read")
    const policyControl = await assertInteractiveControl(policyCheckbox)
    await policyCheckbox.focus()
    await page.keyboard.press("Space")
    const checkedPolicy = await page.waitForFunction(
      (node) =>
        node.isConnected && node.getAttribute("aria-checked") === "true",
      { polling: "raf", timeout: 2000 },
      policyCheckbox
    )
    await checkedPolicy.dispose()
    await policyCheckbox.dispose()
    const policyPath = `/admin/rbac/roles/${fixture.targetRole.id}/policies`
    proxy.arm({
      method: "POST",
      path: policyPath,
      body: { policies: [rolePolicy.id] },
    })
    const beforePolicy = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/roles/${fixture.targetRole.id}`)
    const rolePolicies = await fixture.rows(
      "rbac_role",
      [fixture.targetRole.id],
      ["id", "policies.id", "policies.key"]
    )
    assert.deepEqual(
      nativeRows(rolePolicies[0].policies).map((policy) => policy.id),
      [rolePolicy.id]
    )
    await checkpoint("role-policy-keyboard-select-native-membership", {
      control: policyControl,
      write: assertWrite("POST", policyPath, beforePolicy),
      policyIds: [rolePolicy.id],
    })
    await navigate(`/app/settings/roles/${fixture.targetRole.id}/permissions`)
    const removePolicySearch = await page.$(
      '[role="dialog"] input[placeholder*="Search"]'
    )
    assert.ok(removePolicySearch)
    await removePolicySearch.type("store:read")
    await removePolicySearch.dispose()
    const selectedPolicy = await rowControl(page, "store:read")
    assert.equal(
      await selectedPolicy.evaluate((node) =>
        node.getAttribute("aria-checked")
      ),
      "true"
    )
    await selectedPolicy.focus()
    await page.keyboard.press("Space")
    const uncheckedPolicy = await page.waitForFunction(
      (node) =>
        node.isConnected && node.getAttribute("aria-checked") === "false",
      { polling: "raf", timeout: 2000 },
      selectedPolicy
    )
    await uncheckedPolicy.dispose()
    await selectedPolicy.dispose()
    const removePolicyPath = `${policyPath}/${rolePolicy.id}`
    proxy.arm({ method: "DELETE", path: removePolicyPath })
    const beforePolicyRemove = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/roles/${fixture.targetRole.id}`)
    const removedPolicies = await fixture.rows(
      "rbac_role",
      [fixture.targetRole.id],
      ["id", "policies.id"]
    )
    assert.deepEqual(removedPolicies[0].policies, [])
    await checkpoint("role-policy-remove-native-membership", {
      write: assertWrite("DELETE", removePolicyPath, beforePolicyRemove),
      policyIds: [],
    })

    await navigate(`/app/settings/roles/${fixture.targetRole.id}/add-users`)
    const roleUserSearch = await page.$('[role="dialog"] input[type="search"]')
    assert.ok(roleUserSearch, "Native Role user picker Search is required")
    const beforeUserSearch = proxy.receipts.length
    await roleUserSearch.type(fixture.actors.reader.email)
    await roleUserSearch.dispose()
    await waitRead("/admin/users", beforeUserSearch, {
      q: fixture.actors.reader.email,
    })
    const userSelection = await rowControl(page, fixture.actors.reader.email)
    await assertInteractiveControl(userSelection)
    await userSelection.focus()
    await page.keyboard.press("Space")
    await userSelection.dispose()
    const roleUsersPath = `/admin/rbac/roles/${fixture.targetRole.id}/users`
    proxy.arm({
      method: "POST",
      path: roleUsersPath,
      body: { users: [fixture.actors.reader.id] },
    })
    const beforeRoleUser = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/roles/${fixture.targetRole.id}`)
    const roleMembers = await fixture.rows(
      "user",
      [fixture.actors.reader.id],
      ["id", "rbac_roles.id"]
    )
    assert.ok(
      nativeRows(roleMembers[0].rbac_roles).some(
        (role) => role.id === fixture.targetRole.id
      )
    )
    await checkpoint("role-users-native-membership", {
      write: assertWrite("POST", roleUsersPath, beforeRoleUser),
      userId: fixture.actors.reader.id,
      roleId: fixture.targetRole.id,
    })
    await openActions(page, fixture.actors.reader.email, true)
    await clickText(page, "Remove", '[role="menuitem"]')
    proxy.arm({
      method: "DELETE",
      path: roleUsersPath,
      body: { users: [fixture.actors.reader.id] },
    })
    const beforeRoleUserRemove = proxy.receipts.length
    await confirmDialog(page, "Continue")
    const roleUserRemovalWrite = await waitWrite(
      "DELETE",
      roleUsersPath,
      beforeRoleUserRemove
    )
    const formerMembers = await fixture.rows(
      "user",
      [fixture.actors.reader.id],
      ["id", "rbac_roles.id"]
    )
    assert.equal(
      nativeRows(formerMembers[0].rbac_roles).some(
        (role) => role.id === fixture.targetRole.id
      ),
      false
    )
    await checkpoint("role-users-remove-native-membership", {
      write: roleUserRemovalWrite,
      userId: fixture.actors.reader.id,
    })

    // Create a real native Tax Region through the native form; no external tax
    // calculation is performed by these Settings configuration endpoints.
    await navigate("/app/settings/tax-regions/create")
    await choose(page, "Country", "Canada")
    const taxProviders = await fixture.request("GET", "/admin/tax-providers")
    const taxRows = nativeRows(taxProviders.data.tax_providers)
    const taxProvider = taxRows.find(
      (provider) => provider.id === "tp_rate_lookup_rate-lookup"
    )
    assert.ok(taxProvider, "Actual initialized custom Tax provider is required")
    await choose(page, "Tax provider", providerLabel(taxProvider.id))
    proxy.arm({
      method: "POST",
      path: "/admin/tax-regions",
      body: { country_code: "ca", provider_id: taxProvider.id },
      responseEntity: "tax_region",
    })
    const beforeTax = proxy.receipts.length
    await clickText(page, "Save")
    await page.waitForFunction(
      () =>
        /\/settings\/tax-regions\/txreg_/u.test(location.pathname) &&
        !document.querySelector('[role="dialog"]')
    )
    const taxWrite = assertWrite("POST", "/admin/tax-regions", beforeTax)
    await checkpoint("tax-region-create-native-persistence", {
      write: taxWrite,
      readback: await writeProof("tax_region", taxWrite.createdId, {
        country_code: "ca",
        provider_id: taxProvider.id,
      }),
    })

    const taxCountryPath = `/admin/tax-regions/${taxWrite.createdId}`
    await navigate(`/app/settings/tax-regions/${taxWrite.createdId}/edit`)
    await choose(page, "Tax provider", providerLabel(taxProvider.id))
    proxy.arm({
      method: "POST",
      path: taxCountryPath,
      body: { provider_id: taxProvider.id },
    })
    const beforeTaxEdit = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/tax-regions/${taxWrite.createdId}`)
    await checkpoint("tax-country-provider-resave-native-persistence", {
      write: assertWrite("POST", taxCountryPath, beforeTaxEdit),
      readback: await writeProof("tax_region", taxWrite.createdId, {
        country_code: "ca",
        provider_id: taxProvider.id,
      }),
      acknowledgment:
        "current native projection; no immutable command UUID/version contract",
    })

    await navigate(
      `/app/settings/tax-regions/${taxWrite.createdId}/tax-rates/create`
    )
    const rateName = `Browser rate ${fixture.tag}`
    const rateCode = `BROWSER-${fixture.tag}`
    await fill(page, "Name", rateName)
    await fill(page, "Tax code", rateCode)
    await fill(page, "Tax rate", "5")
    proxy.arm({
      method: "POST",
      path: "/admin/tax-rates",
      body: {
        tax_region_id: taxWrite.createdId,
        name: rateName,
        code: rateCode,
        rate: 5,
        is_default: true,
        is_combinable: false,
      },
      responseEntity: "tax_rate",
    })
    const beforeRate = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/tax-regions/${taxWrite.createdId}`)
    const rateWrite = assertWrite("POST", "/admin/tax-rates", beforeRate)
    await checkpoint("tax-rate-create-native-persistence", {
      write: rateWrite,
      readback: await writeProof("tax_rate", rateWrite.createdId, {
        name: rateName,
        code: rateCode,
        rate: 5,
        tax_region_id: taxWrite.createdId,
      }),
    })

    const editedRateName = `Edited Tax ${fixture.tag}`
    const ratePath = `/admin/tax-rates/${rateWrite.createdId}`
    await navigate(
      `/app/settings/tax-regions/${taxWrite.createdId}/tax-rates/${rateWrite.createdId}/edit`
    )
    await fill(page, "Name", editedRateName)
    await fill(page, "Tax code", rateCode)
    await fill(page, "Tax rate", "9")
    proxy.arm({
      method: "POST",
      path: ratePath,
      body: {
        name: editedRateName,
        code: rateCode,
        rate: 9,
        is_combinable: false,
      },
    })
    const beforeRateEdit = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/tax-regions/${taxWrite.createdId}`)
    await checkpoint("tax-rate-edit-native-persistence", {
      write: assertWrite("POST", ratePath, beforeRateEdit),
      readback: await writeProof("tax_rate", rateWrite.createdId, {
        name: editedRateName,
        code: rateCode,
        rate: 9,
      }),
    })

    await navigate(
      `/app/settings/tax-regions/${taxWrite.createdId}/provinces/create`
    )
    await choose(page, "Province", "Ontario")
    const provinceRateName = `Province Tax ${fixture.tag}`
    const provinceCode = `PROVINCE-${fixture.tag}`
    await fill(page, "Name", provinceRateName)
    await fill(page, "Tax code", provinceCode)
    await fill(page, "Tax rate", "8")
    const combinable = await field(page, "Combinable")
    assert.equal(
      await combinable.evaluate((node) => node.getAttribute("aria-checked")),
      "false"
    )
    const combinableControl = await assertInteractiveControl(combinable)
    await combinable.focus()
    await page.keyboard.press("Space")
    assert.equal(
      await combinable.evaluate((node) => node.getAttribute("aria-checked")),
      "true"
    )
    await combinable.dispose()
    proxy.arm({
      method: "POST",
      path: "/admin/tax-regions",
      body: {
        country_code: "ca",
        province_code: "ca-on",
        parent_id: taxWrite.createdId,
        default_tax_rate: {
          name: provinceRateName,
          rate: 8,
          code: provinceCode,
          is_combinable: true,
        },
      },
      responseEntity: "tax_region",
    })
    const beforeProvince = proxy.receipts.length
    await clickText(page, "Save")
    await page.waitForFunction(
      (parent) =>
        location.pathname.startsWith(
          `/app/settings/tax-regions/${parent}/provinces/`
        ) && !document.querySelector('[role="dialog"]'),
      {},
      taxWrite.createdId
    )
    const provinceWrite = assertWrite(
      "POST",
      "/admin/tax-regions",
      beforeProvince
    )
    const provinceReadback = await writeProof(
      "tax_region",
      provinceWrite.createdId,
      {
        country_code: "ca",
        province_code: "ca-on",
        parent_id: taxWrite.createdId,
      }
    )
    const nativeProvince = await fixture.request(
      "GET",
      `/admin/tax-regions/${provinceWrite.createdId}?fields=*tax_rates`
    )
    assert.equal(nativeProvince.status, 200)
    const provinceRates = nativeRows(nativeProvince.data.tax_region.tax_rates)
    assert.equal(provinceRates.length, 1)
    assert.equal(provinceRates[0].name, provinceRateName)
    assert.equal(provinceRates[0].rate, 8)
    assert.equal(provinceRates[0].is_combinable, true)
    fixture.owned.add(provinceRates[0].id)
    await checkpoint("tax-province-default-rate-native-persistence", {
      write: provinceWrite,
      readback: provinceReadback,
      combinableControl,
      defaultRate: {
        id: provinceRates[0].id,
        name: provinceRateName,
        rate: 8,
        is_combinable: true,
      },
    })

    await navigate(`/app/settings/tax-regions/${taxWrite.createdId}`)
    const rateDeleteControl = await openActions(page, editedRateName)
    await clickText(page, "Delete", '[role="menuitem"]')
    const beforeRateCancel = proxy.receipts.length
    await confirmDialog(page, "Cancel")
    assert.equal(
      proxy.receipts
        .slice(beforeRateCancel)
        .filter((entry) => entry.kind === "native" && entry.method === "DELETE")
        .length,
      0
    )
    await writeProof("tax_rate", rateWrite.createdId, {
      name: editedRateName,
      rate: 9,
    })
    await openActions(page, editedRateName)
    await clickText(page, "Delete", '[role="menuitem"]')
    proxy.arm({ method: "DELETE", path: ratePath })
    const beforeRateDelete = proxy.receipts.length
    await confirmDialog(page, "Delete")
    const rateDelete = await waitWrite("DELETE", ratePath, beforeRateDelete)
    assert.deepEqual(await fixture.rows("tax_rate", [rateWrite.createdId]), [])
    await checkpoint("tax-rate-delete-cancel-then-persistence", {
      control: rateDeleteControl,
      write: rateDelete,
      persistedRows: 0,
    })

    await navigate(
      `/app/settings/tax-regions/${taxWrite.createdId}/provinces/${provinceWrite.createdId}`
    )
    const provinceDeleteControl = await openActions(page, "Ontario")
    await clickText(page, "Delete", '[role="menuitem"]')
    const provincePath = `/admin/tax-regions/${provinceWrite.createdId}`
    proxy.arm({ method: "DELETE", path: provincePath })
    const beforeProvinceDelete = proxy.receipts.length
    await confirmDialog(page, "Delete")
    await waitRoute(page, `/app/settings/tax-regions/${taxWrite.createdId}`)
    const provinceDelete = assertWrite(
      "DELETE",
      provincePath,
      beforeProvinceDelete
    )
    assert.deepEqual(
      await fixture.rows("tax_region", [provinceWrite.createdId]),
      []
    )
    await checkpoint("tax-province-delete-native-persistence", {
      control: provinceDeleteControl,
      write: provinceDelete,
      persistedRows: 0,
    })
    assert.deepEqual(await fixture.rows("tax_rate", [provinceRates[0].id]), [])
    await openActions(page, "Canada")
    await clickText(page, "Delete", '[role="menuitem"]')
    const beforeTaxCancel = proxy.receipts.length
    await confirmDialog(page, "Cancel")
    assert.equal(
      proxy.receipts
        .slice(beforeTaxCancel)
        .filter((entry) => entry.kind === "native" && entry.method === "DELETE")
        .length,
      0
    )
    await writeProof("tax_region", taxWrite.createdId, { country_code: "ca" })
    await openActions(page, "Canada")
    await clickText(page, "Delete", '[role="menuitem"]')
    proxy.arm({ method: "DELETE", path: taxCountryPath })
    const beforeTaxDelete = proxy.receipts.length
    await confirmDialog(page, "Delete")
    await waitRoute(page, "/app/settings/tax-regions")
    const taxDelete = await waitWrite("DELETE", taxCountryPath, beforeTaxDelete)
    assert.deepEqual(await fixture.rows("tax_region", [taxWrite.createdId]), [])
    await checkpoint("tax-country-delete-cancel-then-persistence", {
      write: taxDelete,
      persistedRows: 0,
      provinceRateRows: 0,
    })

    // Region forms offer only currencies supported by the current Store.
    // Preserve the proven USD removal, then restore USD through native UI so
    // Region creation and the subsequent USD-to-EUR edit remain meaningful.
    const regionStoreBefore = await fixture.request("GET", storePath)
    assert.equal(regionStoreBefore.status, 200)
    const regionCurrenciesBefore = nativeRows(
      regionStoreBefore.data.store.supported_currencies
    )
    assert.deepEqual(
      regionCurrenciesBefore.map((currency) => currency.currency_code),
      ["eur"]
    )
    assert.equal(regionCurrenciesBefore[0].is_default, true)
    const regionEurPreferenceBefore = await fixture.request(
      "GET",
      "/admin/price-preferences?attribute=currency_code&value=eur"
    )
    assert.equal(regionEurPreferenceBefore.status, 200)
    const regionEurPreferences = nativeRows(
      regionEurPreferenceBefore.data.price_preferences
    )
    assert.ok(regionEurPreferences.length <= 1)
    for (const preference of regionEurPreferences) {
      assert.equal(preference.value, "eur")
      assert.equal(typeof preference.is_tax_inclusive, "boolean")
    }
    const regionEurPreference = regionEurPreferences[0]
    await navigate("/app/settings/store/currencies")
    const regionCurrencySearch = await page.$(
      '[role="dialog"] input[placeholder*="Search"]'
    )
    assert.ok(regionCurrencySearch, "Native currency Search must exist")
    const beforeRegionCurrencySearch = proxy.receipts.length
    await regionCurrencySearch.type("usd")
    await regionCurrencySearch.dispose()
    await waitRead("/admin/currencies", beforeRegionCurrencySearch, {
      q: "usd",
    })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="dialog"] tbody tr')].some((row) =>
        [...row.querySelectorAll("td")].some(
          (cell) => cell.textContent?.trim() === "USD"
        )
      )
    )
    const regionUsdCheckbox = await page.evaluateHandle(() => {
      const rows = [
        ...document.querySelectorAll('[role="dialog"] tbody tr'),
      ].filter((row) =>
        [...row.querySelectorAll("td")].some(
          (cell) => cell.textContent?.trim() === "USD"
        )
      )
      if (rows.length !== 1) return null
      const controls = rows[0].querySelectorAll('[role="checkbox"]')
      return controls.length === 1 ? controls[0] : null
    })
    const regionUsdControl = regionUsdCheckbox.asElement()
    assert.ok(regionUsdControl, "One native USD row checkbox is required")
    let regionUsdControlProof
    try {
      assert.equal(
        await regionUsdControl.evaluate((node) =>
          node.getAttribute("aria-checked")
        ),
        "false"
      )
      regionUsdControlProof = await assertInteractiveControl(regionUsdControl)
      await regionUsdControl.click()
      assert.equal(
        await regionUsdControl.evaluate((node) =>
          node.getAttribute("aria-checked")
        ),
        "true"
      )
    } finally {
      await regionUsdCheckbox.dispose()
    }
    proxy.arm({
      method: "POST",
      path: storePath,
      body: {
        supported_currencies: [
          { currency_code: "usd", is_default: false },
          {
            currency_code: "eur",
            is_default: true,
            ...(regionEurPreference
              ? { is_tax_inclusive: regionEurPreference.is_tax_inclusive }
              : {}),
          },
        ],
      },
    })
    const beforeRegionCurrencyRestore = proxy.receipts.length
    const regionCurrencyRestoreSubmit = await submitNativeDialog(
      page,
      "Save",
      () => waitRoute(page, "/app/settings/store")
    )
    const regionCurrencyRestoreWrite = assertWrite(
      "POST",
      storePath,
      beforeRegionCurrencyRestore
    )
    const regionStoreAfter = await fixture.request("GET", storePath)
    assert.equal(regionStoreAfter.status, 200)
    const regionCurrenciesAfter = nativeRows(
      regionStoreAfter.data.store.supported_currencies
    )
    assert.deepEqual(
      regionCurrenciesAfter.map((currency) => currency.currency_code).sort(),
      ["eur", "usd"]
    )
    assert.deepEqual(
      regionCurrenciesAfter
        .filter((currency) => currency.is_default)
        .map((currency) => currency.currency_code),
      ["eur"]
    )
    const regionStoreQueryAfter = await fixture.rows(
      "store",
      [current.id],
      [
        "id",
        "supported_currencies.currency_code",
        "supported_currencies.is_default",
      ]
    )
    assert.equal(regionStoreQueryAfter.length, 1)
    assert.deepEqual(
      nativeRows(regionStoreQueryAfter[0].supported_currencies)
        .map((currency) => ({
          currency_code: currency.currency_code,
          is_default: currency.is_default,
        }))
        .sort((left, right) =>
          left.currency_code.localeCompare(right.currency_code)
        ),
      [
        { currency_code: "eur", is_default: true },
        { currency_code: "usd", is_default: false },
      ]
    )
    const regionEurPreferenceAfter = await fixture.request(
      "GET",
      "/admin/price-preferences?attribute=currency_code&value=eur"
    )
    assert.equal(regionEurPreferenceAfter.status, 200)
    assert.deepEqual(
      nativeRows(regionEurPreferenceAfter.data.price_preferences).map(
        (preference) => ({
          value: preference.value,
          is_tax_inclusive: preference.is_tax_inclusive,
        })
      ),
      regionEurPreferences.map((preference) => ({
        value: preference.value,
        is_tax_inclusive: preference.is_tax_inclusive,
      }))
    )
    await checkpoint("store-native-usd-readd-region-precondition", {
      control: regionUsdControlProof,
      submit: regionCurrencyRestoreSubmit,
      write: regionCurrencyRestoreWrite,
      supportedCurrencyCodes: ["eur", "usd"],
      defaultCurrency: "eur",
      eurTaxPreferenceUnchanged: true,
      independentHttpAndQueryReadback: true,
      priorUsdRemovalCoveragePreserved: true,
    })

    await navigate("/app/settings/regions/create")
    const regionName = `Browser Region ${fixture.tag}`
    await fill(page, "Name", regionName)
    await choose(page, "Currency", "US Dollar")
    await choose(page, "Payment Providers", providerLabel("pp_system_default"))
    const automaticTaxes = await field(page, "Automatic Taxes")
    assert.equal(
      await automaticTaxes.evaluate((node) =>
        node.getAttribute("aria-checked")
      ),
      "true"
    )
    await automaticTaxes.click()
    await automaticTaxes.dispose()
    proxy.arm({
      method: "POST",
      path: "/admin/regions",
      body: {
        name: regionName,
        countries: [],
        currency_code: "USD",
        payment_providers: ["pp_system_default"],
        automatic_taxes: false,
        is_tax_inclusive: false,
      },
      responseEntity: "region",
    })
    const beforeRegion = proxy.receipts.length
    const regionCreateSubmit = await submitNativeDialog(page, "Save", () =>
      page.waitForFunction(
        () =>
          /\/settings\/regions\/reg_/u.test(location.pathname) &&
          !document.querySelector('[role="dialog"]')
      )
    )
    const regionWrite = assertWrite("POST", "/admin/regions", beforeRegion)
    await checkpoint("region-create-native-persistence", {
      submit: regionCreateSubmit,
      write: regionWrite,
      readback: await writeProof("region", regionWrite.createdId, {
        name: regionName,
        currency_code: "usd",
        automatic_taxes: false,
      }),
    })

    const regionPath = `/admin/regions/${regionWrite.createdId}`
    const editedRegionName = `Edited Region ${fixture.tag}`
    await navigate(`/app/settings/regions/${regionWrite.createdId}/edit`)
    await fill(page, "Name", editedRegionName)
    await choose(page, "Currency", "EUR")
    const inclusiveRegion = await field(page, "Tax inclusive pricing")
    assert.equal(
      await inclusiveRegion.evaluate((node) =>
        node.getAttribute("aria-checked")
      ),
      "false"
    )
    await assertInteractiveControl(inclusiveRegion)
    await inclusiveRegion.focus()
    await page.keyboard.press("Space")
    await inclusiveRegion.dispose()
    proxy.arm({
      method: "POST",
      path: regionPath,
      body: {
        name: editedRegionName,
        currency_code: "eur",
        automatic_taxes: false,
        payment_providers: ["pp_system_default"],
        is_tax_inclusive: true,
      },
    })
    const beforeRegionEdit = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/regions/${regionWrite.createdId}`)
    const regionPreferences = await fixture.request(
      "GET",
      `/admin/price-preferences?attribute=region_id&value=${regionWrite.createdId}`
    )
    assert.equal(regionPreferences.status, 200)
    assert.equal(
      nativeRows(regionPreferences.data.price_preferences).find(
        (preference) => preference.value === regionWrite.createdId
      )?.is_tax_inclusive,
      true
    )
    await checkpoint(
      "region-currency-tax-inclusive-provider-native-persistence",
      {
        write: assertWrite("POST", regionPath, beforeRegionEdit),
        readback: await writeProof("region", regionWrite.createdId, {
          name: editedRegionName,
          currency_code: "eur",
          automatic_taxes: false,
        }),
        isTaxInclusive: true,
      }
    )

    await navigate(
      `/app/settings/regions/${regionWrite.createdId}/countries/add`
    )
    const countrySearch = await page.$(
      '[role="dialog"] input[placeholder*="Search"]'
    )
    assert.ok(countrySearch)
    await countrySearch.type("Canada")
    await countrySearch.dispose()
    const countrySelect = await rowControl(page, "Canada")
    const countrySelectControl = await assertInteractiveControl(countrySelect)
    await countrySelect.focus()
    await page.keyboard.press("Space")
    await countrySelect.dispose()
    proxy.arm({ method: "POST", path: regionPath, body: { countries: ["ca"] } })
    const beforeCountryAdd = proxy.receipts.length
    await clickText(page, "Add")
    await waitRoute(page, `/app/settings/regions/${regionWrite.createdId}`)
    const regionCountryRead = await fixture.request(
      "GET",
      `${regionPath}?fields=*countries,*payment_providers`
    )
    assert.equal(regionCountryRead.status, 200)
    assert.deepEqual(
      nativeRows(regionCountryRead.data.region.countries).map(
        (country) => country.iso_2
      ),
      ["ca"]
    )
    assert.deepEqual(
      nativeRows(regionCountryRead.data.region.payment_providers).map(
        (provider) => provider.id
      ),
      ["pp_system_default"]
    )
    await checkpoint("region-country-keyboard-add-native-persistence", {
      control: countrySelectControl,
      write: assertWrite("POST", regionPath, beforeCountryAdd),
      countries: ["ca"],
      paymentProviderIds: ["pp_system_default"],
    })

    await openActions(page, "Canada", true)
    await clickText(page, "Remove", '[role="menuitem"]')
    proxy.arm({ method: "POST", path: regionPath, body: { countries: [] } })
    const beforeCountryRemove = proxy.receipts.length
    const countryRemoveConfirmation = await confirmDialog(
      page,
      "Remove",
      "Canada"
    )
    const countryRemoval = await waitWrite(
      "POST",
      regionPath,
      beforeCountryRemove
    )
    const noCountries = await fixture.request(
      "GET",
      `${regionPath}?fields=*countries`
    )
    assert.equal(noCountries.status, 200)
    assert.deepEqual(noCountries.data.region.countries, [])
    await checkpoint("region-country-verified-remove-native-persistence", {
      confirmation: countryRemoveConfirmation,
      write: countryRemoval,
      countries: [],
    })

    await navigate(
      `/app/settings/regions/${regionWrite.createdId}/metadata/edit`
    )
    await page.type('input[name="metadata.0.key"]', "owned_audit")
    await page.type('input[name="metadata.0.value"]', "true")
    proxy.arm({
      method: "POST",
      path: regionPath,
      body: { metadata: { owned_audit: true } },
    })
    const beforeRegionMetadata = proxy.receipts.length
    await clickText(page, "Save")
    await waitRoute(page, `/app/settings/regions/${regionWrite.createdId}`)
    await checkpoint("region-metadata-type-native-persistence", {
      write: assertWrite("POST", regionPath, beforeRegionMetadata),
      readback: await writeProof("region", regionWrite.createdId, {
        metadata: { owned_audit: true },
      }),
    })

    await openActions(page, editedRegionName)
    await clickText(page, "Delete", '[role="menuitem"]')
    const beforeRegionDeleteCancel = proxy.receipts.length
    await confirmDialog(page, "Cancel")
    assert.equal(
      proxy.receipts
        .slice(beforeRegionDeleteCancel)
        .filter((entry) => entry.kind === "native" && entry.method === "DELETE")
        .length,
      0
    )
    await writeProof("region", regionWrite.createdId, {
      name: editedRegionName,
    })
    await openActions(page, editedRegionName)
    await clickText(page, "Delete", '[role="menuitem"]')
    proxy.arm({ method: "DELETE", path: regionPath })
    const beforeRegionDelete = proxy.receipts.length
    await confirmDialog(page, "Delete", editedRegionName)
    await waitRoute(page, "/app/settings/regions")
    const regionDelete = assertWrite("DELETE", regionPath, beforeRegionDelete)
    assert.deepEqual(await fixture.rows("region", [regionWrite.createdId]), [])
    await checkpoint("region-verified-delete-cancel-then-persistence", {
      write: regionDelete,
      persistedRows: 0,
    })

    const ordinaryRolePath = `/admin/rbac/roles/${roleCreate.createdId}`
    await navigate(`/app/settings/roles/${roleCreate.createdId}`)
    await openActions(page, createdRoleName)
    await clickText(page, "Delete", '[role="menuitem"]')
    proxy.arm({ method: "DELETE", path: ordinaryRolePath })
    const beforeOrdinaryRoleDelete = proxy.receipts.length
    await confirmDialog(page, "Delete")
    await waitRoute(page, "/app/settings/roles")
    const ordinaryRoleDelete = assertWrite(
      "DELETE",
      ordinaryRolePath,
      beforeOrdinaryRoleDelete
    )
    assert.deepEqual(
      await fixture.rows("rbac_role", [roleCreate.createdId]),
      []
    )
    await checkpoint("ordinary-role-delete-native-persistence", {
      write: ordinaryRoleDelete,
      persistedRows: 0,
    })

    await navigate(`/app/settings/users/${fixture.actors.none.id}`)
    await openActions(page, fixture.actors.none.email)
    await clickText(page, "Delete", '[role="menuitem"]')
    const spareUserPath = `/admin/users/${fixture.actors.none.id}`
    proxy.arm({ method: "DELETE", path: spareUserPath })
    const beforeSpareUserDelete = proxy.receipts.length
    await confirmDialog(page, "Delete", "Settings none")
    const spareUserDelete = await waitWrite(
      "DELETE",
      spareUserPath,
      beforeSpareUserDelete
    )
    await waitRoute(page, "/app/settings/users")
    assert.deepEqual(await fixture.rows("user", [fixture.actors.none.id]), [])
    await checkpoint("other-user-verified-delete-native-persistence", {
      write: spareUserDelete,
      persistedRows: 0,
    })

    await navigate(`/app/settings/users/${fixture.actors.owner.id}`)
    await openActions(page, fixture.actors.owner.email)
    await clickText(page, "Delete", '[role="menuitem"]')
    const selfPath = `/admin/users/${fixture.actors.owner.id}`
    proxy.arm({ method: "DELETE", path: selfPath })
    const beforeSelfDelete = proxy.receipts.length
    await confirmDialog(page, "Delete", "Settings owner")
    const selfDelete = await waitWrite(
      "DELETE",
      selfPath,
      beforeSelfDelete,
      400
    )
    await checkpoint("self-user-delete-native-400-preserves-user", {
      write: selfDelete,
      readback: await writeProof("user", fixture.actors.owner.id, {
        email: fixture.actors.owner.email,
      }),
    })

    // Cancel a dirty native Role edit without creating an armed command.
    await navigate(`/app/settings/roles/${fixture.targetRole.id}/edit`)
    await fill(page, "Name", "Canceled edit")
    const beforeCancel = proxy.receipts.length
    await clickText(page, "Cancel")
    await page.waitForSelector('[role="alertdialog"]')
    assert.equal(
      await page.$$eval('[role="alertdialog"]', (nodes) => nodes.length),
      1
    )
    assert.equal(
      await page.$eval('[role="alertdialog"] h2', (node) =>
        node.textContent.trim()
      ),
      "Are you sure you want to leave this form?"
    )
    await confirmDialog(page, "Continue")
    await waitRoute(page, `/app/settings/roles/${fixture.targetRole.id}`)
    assert.equal(
      proxy.receipts
        .slice(beforeCancel)
        .filter((entry) => ["POST", "DELETE"].includes(entry.method)).length,
      0
    )
    await checkpoint("role-dirty-cancel-no-write", {
      readback: await writeProof("rbac_role", fixture.targetRole.id, {
        name: roleName,
      }),
    })

    await navigate(`/app/settings/roles/${fixture.targetRole.id}/edit`)
    const reconciledRoleName = `Reply-loss role ${fixture.tag}`
    await fill(page, "Name", reconciledRoleName)
    proxy.arm({
      method: "POST",
      path: rolePath,
      body: { name: reconciledRoleName, description: "Owned UI edit" },
    })
    proxy.faultOnce({ method: "POST", path: rolePath, kind: "drop-response" })
    const beforeReplyLoss = proxy.receipts.length
    await clickText(page, "Save")
    const committedReplyLoss = await waitWrite(
      "POST",
      rolePath,
      beforeReplyLoss
    )
    assert.equal(committedReplyLoss.transportFaultApplied, true)
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (node) => node.textContent?.trim() === "Save" && !node.disabled
      )
    )
    const reconciledProjection = await writeProof(
      "rbac_role",
      fixture.targetRole.id,
      {
        name: reconciledRoleName,
        description: "Owned UI edit",
      }
    )
    const replyLossAttempts = proxy.receipts
      .slice(beforeReplyLoss)
      .filter(
        (entry) =>
          entry.method === "POST" &&
          (entry.kind === "denied" ? entry.pathname : entry.path) === rolePath
      )
    assert.equal(
      replyLossAttempts.length,
      1,
      "A lost native response must not replay its write"
    )
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-sonner-toast]")].some(
          (node) =>
            node.textContent?.includes("Failed to fetch") &&
            Number(getComputedStyle(node).opacity) >= 0.99 &&
            node
              .getAnimations()
              .every((animation) =>
                ["finished", "idle"].includes(animation.playState)
              )
        ),
      { timeout: 2000, polling: "raf" }
    )
    const notificationLayout = await page.evaluate(() => {
      const rect = (node) => {
        const box = node.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        }
      }
      const dialog = document.querySelector('[role="dialog"]')
      const heading = document.getElementById(
        dialog?.getAttribute("aria-labelledby") ?? ""
      )
      const toast = [...document.querySelectorAll("[data-sonner-toast]")].find(
        (node) => node.textContent?.includes("Failed to fetch")
      )
      const actions = [...(dialog?.querySelectorAll("button") ?? [])].filter(
        (node) => ["Cancel", "Save"].includes(node.textContent?.trim())
      )
      if (!heading || !toast || actions.length !== 2) return null
      return {
        viewport: { width: innerWidth, height: innerHeight },
        toast: rect(toast),
        heading: rect(heading),
        actions: actions.map(rect),
      }
    })
    assert.ok(notificationLayout, "Native error and form landmarks must render")
    const { toast: notification, viewport } = notificationLayout
    assert.ok(
      notification.left >= 0 &&
        notification.top >= 0 &&
        notification.right <= viewport.width &&
        notification.bottom <= viewport.height,
      "Native error notification must remain inside the viewport"
    )
    for (const landmark of [
      notificationLayout.heading,
      ...notificationLayout.actions,
    ])
      assert.ok(
        notification.right <= landmark.left ||
          notification.left >= landmark.right ||
          notification.bottom <= landmark.top ||
          notification.top >= landmark.bottom,
        "Native error notification must not cover the form heading or actions"
      )
    await checkpoint("native-role-response-loss-committed-projection", {
      write: committedReplyLoss,
      readback: reconciledProjection,
      acknowledgment:
        "response uncertain; separate current persisted projection readback",
      automaticWriteRetries: replyLossAttempts.length - 1,
      notificationLayout,
    })
    await navigationIdle.reload()
    const reconciledName = await field(page, "Name")
    assert.equal(
      await reconciledName.evaluate((node) => node.value),
      reconciledRoleName
    )
    await reconciledName.dispose()
    assertWrite("POST", rolePath, beforeReplyLoss)
    await checkpoint("native-role-response-loss-reload-reconciliation", {
      nativeProjection: reconciledProjection,
      submittedWrites: 1,
      replay: "none",
      scope:
        "native Settings lacks immutable command acknowledgment; reload reads the current owned record",
    })

    for (const definition of tableDefinitions.filter((item) => !item.tax)) {
      await observeReadOnlyControl(`${definition.name}-descending-sort`, () =>
        checkNativeDescendingSort(definition)
      )
      await observeReadOnlyControl(`${definition.name}-date-filter`, () =>
        checkNativeDateFilter(definition)
      )
    }
    await observeReadOnlyControl("tax-regions-sort", checkNativeTaxSort)

    await page.evaluate(() => window.__sdk.auth.logout())
    await signIn(fixture.actors.reader)
    proxy.faultOnce({
      method: "GET",
      path: "/admin/rbac/me/permissions",
      kind: "delay",
      delayMs: 2000,
    })
    const beforeDenial = proxy.receipts.length
    await page.goto(`${proxy.origin}/app/settings/roles/create`, {
      waitUntil: "domcontentloaded",
    })
    const heldDeadline = Date.now() + 15_000
    let heldResponse
    while (!heldResponse && Date.now() < heldDeadline) {
      heldResponse = proxy.receipts
        .slice(beforeDenial)
        .find(
          (entry) =>
            entry.path === "/admin/rbac/me/permissions" &&
            entry.transportFault === "delay" &&
            entry.transportResponseHeld
        )
      if (!heldResponse) await new Promise((done) => setTimeout(done, 10))
    }
    assert.ok(
      heldResponse,
      "The actual native permissions response was not held"
    )
    const loadSamples = []
    while (heldResponse.transportResponseHeld) {
      const sample = await page.evaluate(() => ({
        inputs: document.querySelectorAll('main input,[role="dialog"] input')
          .length,
        createButtons: [...document.querySelectorAll("button")].filter(
          (node) => node.textContent?.trim() === "Create"
        ).length,
      }))
      if (heldResponse.transportResponseHeld) loadSamples.push(sample)
      await new Promise((done) => setTimeout(done, 40))
    }
    assert.ok(
      loadSamples.length > 0,
      "No controls were sampled while the real response was held"
    )
    const duringLoad = {
      samples: loadSamples.length,
      inputs: Math.max(...loadSamples.map((sample) => sample.inputs)),
      createButtons: Math.max(
        ...loadSamples.map((sample) => sample.createButtons)
      ),
      actualNativeResponseHeld: true,
    }
    await page.waitForFunction(
      () => document.body.textContent?.includes("Access Denied"),
      { timeout: 15_000 }
    )
    assert.equal(
      proxy.receipts
        .slice(beforeDenial)
        .filter((entry) => ["POST", "DELETE"].includes(entry.method)).length,
      0
    )
    await checkpoint("reader-role-create-denial-delayed-native-permissions", {
      duringLoad,
      immutableWrites: 0,
      sourceLoadingGuardObservation: "actual-controls-observed-before-denial",
    })
    assert.equal(
      duringLoad.inputs,
      0,
      "Protected Role controls mounted while native permissions were loading"
    )
    assert.equal(
      duringLoad.createButtons,
      0,
      "Protected Create mounted while native permissions were loading"
    )

    assert.equal(
      deniedRemote.length,
      0,
      "Native browser attempted a remote origin"
    )
    assert.equal(
      readOnlyControlFindings.length,
      0,
      `Native read-only control failures: ${readOnlyControlFindings.map((finding) => finding.name).join(", ")}`
    )
    assert.equal(nativeErrors.length, 0, "Native browser raised page errors")
    assert.equal(
      proxy.receipts.filter((entry) => entry.kind === "denied").length,
      0,
      "Native Settings transport rejected unexpected UI traffic"
    )
    assert.deepEqual(
      await fileHashes(adminRoot),
      compiled,
      "Compiled native source artifacts changed during browser acceptance"
    )
  } catch (problem) {
    error = {
      name: problem.name,
      message: problem.message,
      ...(problem.nativeControlProof
        ? { nativeControlProof: problem.nativeControlProof }
        : {}),
      ...(problem.nativeScrollerProof
        ? { nativeScrollerProof: problem.nativeScrollerProof }
        : {}),
      ...(problem.nativeMenuClosureProof
        ? { nativeMenuClosureProof: problem.nativeMenuClosureProof }
        : {}),
      ...(problem.nativeDialogSubmitProof
        ? { nativeDialogSubmitProof: problem.nativeDialogSubmitProof }
        : {}),
    }
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: join(output, "failed-current-state.png"),
          fullPage: true,
          optimizeForSpeed: true,
        })
        .catch(() => {})
    throw problem
  } finally {
    const cleanup = await closeSettingsResources([
      [
        "native-session",
        async () => {
          if (page && !page.isClosed())
            await page.evaluate(() => window.__sdk?.auth.logout())
        },
      ],
      [
        "owned-navigation-idle-tracker",
        async () => {
          await navigationIdle?.dispose()
        },
      ],
      [
        "owned-browser-context",
        async () => {
          await context?.close()
        },
      ],
      [
        "owned-browser",
        async () => {
          await browser?.close()
        },
      ],
      [
        "owned-loopback-proxy",
        async () => {
          await proxy.close()
        },
      ],
    ])
    const cleanupFailures = cleanup.filter((item) => item.status === "failed")
    let finalIntegrityError = null
    try {
      assert.equal(deniedRemote.length, 0, "Late native browser remote traffic")
      assert.equal(nativeErrors.length, 0, "Late native browser page errors")
      assert.equal(
        proxy.receipts.filter((entry) => entry.kind === "denied").length,
        0,
        "Final native request journal contains rejected traffic"
      )
      assert.deepEqual(
        proxy.transportState(),
        {
          closed: true,
          activeOperations: 0,
          clientSockets: 0,
          upstreamRequests: 0,
          upstreamSockets: 0,
          agentActiveSockets: 0,
          agentIdleSockets: 0,
          agentQueuedRequests: 0,
        },
        "Owned upstream/client resources must be absent before the final journal is accepted"
      )
      const ownedBrowserChild = browser?.process()
      assert.ok(
        !ownedBrowserChild ||
          ownedBrowserChild.exitCode !== null ||
          ownedBrowserChild.signalCode !== null,
        "Owned browser process remains after cleanup"
      )
      assert.deepEqual(
        await fileHashes(adminRoot),
        compiled,
        "Compiled artifacts changed before final journal closure"
      )
    } catch (problem) {
      finalIntegrityError = { name: problem.name, message: problem.message }
    }
    const result = {
      schemaVersion: 1,
      kind: "initialized-native-settings-compiled-browser",
      mode,
      status:
        error || cleanupFailures.length || finalIntegrityError
          ? "failed"
          : "passed",
      cases,
      error,
      initialNativeNetworkComparison: initialNetworkComparison,
      navigationReadinessObservation: {
        diagnosticOnly: true,
        limits: navigationObservationLimits,
        observedCount: navigationObservationCount,
        deadlineCount: navigationDeadlineObservationCount,
        ringTruncated:
          navigationObservationCount > navigationObservationLimits.ring,
        deadlinesTruncated:
          navigationDeadlineObservationCount >
          navigationObservationLimits.deadlines,
        snapshots: navigationObservations,
        deadlineSnapshots: navigationDeadlineObservations,
        predicatesEventsDeadlineAndDisposalUnchanged: true,
        rawUrlPathHeadersAuthenticationAndBodiesExported: false,
      },
      cleanup,
      finalIntegrityError,
      finalTransportState: proxy.transportState(),
      ownedBrowserProcess: browser?.process()
        ? {
            pid: browser.process().pid,
            exitCode: browser.process().exitCode,
            signalCode: browser.process().signalCode,
          }
        : null,
      deniedRemote,
      nativeErrors,
      readOnlyControlFindings,
      requests: proxy.receipts,
      compiledFiles: compiled,
      proofScope:
        "real native authentication/RBAC/API/workflow/database with isolated synthetic data",
      nativeTableSetup: tableFixtures,
      remainingUiFamilies: [
        "User detail role mutation and Policy CRUD are API-only in installed native route map",
        "Tax override target selection requires actual owned Product/Product type/Shipping option fixtures",
        "Tax metadata component is absent from installed native route map; reachability remains unverified",
        "Native list column/selection controls are unavailable by installed props; updated-date/custom-range variants remain",
      ],
    }
    await writeFile(
      join(output, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o600, flag: "wx" }
    )
    // Diagnostic output failure never replaces the original native return/error.
    // A missing timing file is not timing evidence.
    await writeFile(
      join(output, "checkpoint-phase-timing.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "native-settings-checkpoint-phase-timing",
          diagnosticOnly: true,
          mode,
          limits: checkpointTimingLimits,
          phaseNames: checkpointTimingPhaseNames,
          observedCheckpoints: checkpointTimingObserved,
          checkpointsTruncated:
            checkpointTimingObserved > checkpointTimingLimits.checkpoints,
          checkpoints: checkpointTimingRows,
          recordedAfterOwnedCleanupAndOriginalResultWrite: true,
          originalResultsSchemaChanged: false,
          rawUrlPathHeadersAuthenticationBodiesArgumentsAndDomExported: false,
          nativeAcceptance: false,
        },
        null,
        2
      )}\n`,
      { mode: 0o600, flag: "wx" }
    ).catch(() => {})
    if (!error && finalIntegrityError)
      throw new Error(finalIntegrityError.message)
    if (!error && cleanupFailures.length)
      throw new Error(
        `Native Settings cleanup failed: ${cleanupFailures.map((item) => item.name).join(", ")}`
      )
  }
}
