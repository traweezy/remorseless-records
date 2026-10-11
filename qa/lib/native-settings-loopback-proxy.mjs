import assert from "node:assert/strict"
import { createHash, timingSafeEqual } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import { Agent, createServer, request as httpRequest } from "node:http"
import { dirname, extname, isAbsolute, resolve, sep } from "node:path"
import { performance } from "node:perf_hooks"
import { readPinnedNativeAsset } from "./pinned-native-asset.mjs"

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const methods = new Set(["GET", "HEAD", "POST", "DELETE"])
const entities = new Set([
  "stores",
  "users",
  "regions",
  "tax-regions",
  "tax-rates",
  "sales-channels",
  "stock-locations",
  "price-preferences",
  "currencies",
  "tax-providers",
  "products",
])
const readOnlyCollections = new Set(["currencies", "tax-providers", "products"])
const mutableEntities = new Set([
  "stores",
  "users",
  "regions",
  "tax-regions",
  "tax-rates",
])
const safeId = (id) => typeof id === "string" && /^[\w-]{1,255}$/u.test(id)
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}
const bodyLimit = 32_768
const responseLimit = 2_097_152
const headerNames = [
  "accept",
  "authorization",
  "content-type",
  "cookie",
  "origin",
]
const mediaTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
}

// This vocabulary is for redacted diagnostics only. It grants no route access.
const journalPathSegments = new Set([
  ...entities,
  "admin",
  "rbac",
  "roles",
  "policies",
  "assignable",
  "me",
  "permissions",
  "orders",
  "product-variants",
  "product-categories",
  "collections",
  "customers",
  "customer-groups",
  "inventory-items",
  "promotions",
  "campaigns",
  "price-lists",
  "return-reasons",
  "product-types",
  "product-tags",
  "shipping-profiles",
  "api-keys",
  "notifications",
  "layouts",
  "sidebar",
  "topbar",
  "configuration",
  "configurations",
  "feed",
  "payments",
  "payment-providers",
  "feature-flags",
  "catalog",
  "media",
  "auth",
  "user",
  "emailpass",
  "session",
  "cloud",
  "app",
  "assets",
  "usd",
  "eur",
])
const journalQueryNames = new Set([
  "q",
  "limit",
  "offset",
  "order",
  "fields",
  "id",
  "user_id",
  "role_id",
  "parent_id",
  "tax_region_id",
  "created_at",
  "updated_at",
  "deleted_at",
  "country_code",
  "province_code",
  "type",
  "publishable",
  "is_system",
])

const nativeLayoutReads = new Set([
  "/admin/layouts/sidebar/configuration",
  "/admin/layouts/topbar/configuration",
  "/admin/layouts/settings.sidebar/configuration",
  // Installed Settings LayoutComposer prefixes and the native SDK's exact
  // retrieveConfiguration GET contract; no layout writes or other zones.
  "/admin/layouts/store.details/configuration",
  "/admin/layouts/user.list/configuration",
  "/admin/layouts/user.details/configuration",
  "/admin/layouts/role.list/configuration",
  "/admin/layouts/role.details/configuration",
  "/admin/layouts/policy.list/configuration",
  "/admin/layouts/policy.details/configuration",
  "/admin/layouts/region.list/configuration",
  "/admin/layouts/region.details/configuration",
  "/admin/layouts/tax.list/configuration",
  "/admin/layouts/tax.details/configuration",
  "/admin/layouts/configurations",
])
const exactParameters = (parameters, expected) => {
  const entries = [...parameters]
  return (
    entries.length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) =>
        parameters.getAll(key).length === 1 && parameters.get(key) === value
    )
  )
}
const nativeShellReadMatches = (method, pathname, parameters) => {
  if (nativeLayoutReads.has(pathname))
    return (
      method === "GET" &&
      exactParameters(
        parameters,
        pathname === "/admin/layouts/configurations"
          ? { limit: "1", fields: "id" }
          : {}
      )
    )
  if (pathname === "/admin/notifications")
    return (
      method === "GET" &&
      exactParameters(parameters, {
        limit: "1",
        offset: "0",
        fields: "created_at",
      })
    )
  return null
}

// Fixed field names only: unknown keys and all primitive values are omitted.
const writeSchemaNames = new Set([
  "name",
  "first_name",
  "last_name",
  "description",
  "metadata",
  "code",
  "currency_code",
  "supported_currencies",
  "is_default",
  "is_tax_inclusive",
  "default_region_id",
  "default_sales_channel_id",
  "default_location_id",
  "countries",
  "country_code",
  "province_code",
  "parent_id",
  "provider_id",
  "payment_providers",
  "automatic_taxes",
  "tax_region_id",
  "rate",
  "is_combinable",
  "rules",
  "reference",
  "reference_id",
  "users",
  "roles",
  "policies",
  "policy_ids",
  "add",
  "remove",
  "id",
])
export const settingsWriteShape = (value) => {
  let remaining = 128
  const shape = (entry, depth = 0) => {
    const type =
      entry === null ? "null" : Array.isArray(entry) ? "array" : typeof entry
    remaining--
    if (depth > 4) return { type, bounded: true }
    if (type === "array") {
      const items = []
      for (const item of entry.slice(0, 16)) {
        if (remaining === 0) break
        items.push(shape(item, depth + 1))
      }
      return {
        type,
        length: entry.length,
        items,
        truncated: entry.length > items.length,
      }
    }
    if (type === "object") {
      const keys = Object.keys(entry),
        known = keys.filter((key) => writeSchemaNames.has(key)).sort(),
        fields = {}
      for (const key of known) {
        if (remaining === 0) break
        fields[key] = shape(entry[key], depth + 1)
      }
      return {
        type,
        fields,
        unknownFieldCount: keys.length - known.length,
        omittedKnownFieldCount: known.length - Object.keys(fields).length,
      }
    }
    return { type }
  }
  return shape(value)
}

const writeMismatchEvidence = (
  intent,
  parsed,
  bytes,
  method,
  pathname,
  queryAbsent,
  mutable
) => {
  const actual = canonical(parsed),
    expected = intent?.body === undefined ? undefined : JSON.parse(intent.body)
  return {
    intentPending: !!intent,
    methodMatched: intent?.method === method,
    pathMatched: intent?.path === pathname,
    queryAbsent,
    mutablePathMatched: mutable,
    canonicalBodyMatched: !!intent && actual === intent.body,
    requestBodyBytes: bytes.length,
    requestBodySha256: hash(bytes),
    actualCanonicalBodySha256: hash(actual ?? ""),
    expectedCanonicalBodySha256: intent ? hash(intent.body ?? "") : null,
    actualShape: settingsWriteShape(parsed),
    expectedShape: settingsWriteShape(expected),
    ...(/^\/admin\/stores\/[\w-]{1,255}$/u.test(pathname)
      ? { storeFields: settingsStoreWriteMismatch(expected, parsed) }
      : {}),
  }
}

// Store diagnostics use only these five fixed native form fields. SHA/equality
// records locate same-type differences without exporting values or row bodies.
export const settingsStoreWriteMismatch = (expected, actual) => {
  const type = (value) =>
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    fields = [
      "name",
      "supported_currencies",
      "default_region_id",
      "default_sales_channel_id",
      "default_location_id",
    ],
    digest = (value) => hash(canonical(value) ?? ""),
    fieldProof = (key) => {
      const expectedPresent = record(expected) && Object.hasOwn(expected, key),
        actualPresent = record(actual) && Object.hasOwn(actual, key)
      return {
        expectedPresent,
        actualPresent,
        expectedType: type(expectedPresent ? expected[key] : undefined),
        actualType: type(actualPresent ? actual[key] : undefined),
        expectedSha256: expectedPresent ? digest(expected[key]) : null,
        actualSha256: actualPresent ? digest(actual[key]) : null,
        canonicalMatched:
          expectedPresent === actualPresent &&
          (!expectedPresent ||
            canonical(expected[key]) === canonical(actual[key])),
      }
    },
    rows = (value) => {
      if (!Array.isArray(value))
        return { count: null, orderedRowSha256: [], truncated: false }
      return {
        count: value.length,
        orderedRowSha256: value.slice(0, 64).map(digest),
        truncated: value.length > 64,
      }
    }
  return {
    fields: Object.fromEntries(fields.map((key) => [key, fieldProof(key)])),
    expectedCurrencies: rows(
      record(expected) ? expected.supported_currencies : undefined
    ),
    actualCurrencies: rows(
      record(actual) ? actual.supported_currencies : undefined
    ),
  }
}

export const settingsDeniedTarget = (request, origin, owned) => {
  const method = [
    "GET",
    "HEAD",
    "POST",
    "DELETE",
    "PUT",
    "PATCH",
    "OPTIONS",
  ].includes(request.method)
    ? request.method
    : "OTHER"
  try {
    const url = new URL(request.url, origin)
    const segments = url.pathname.split("/").slice(1)
    const pathname =
      segments.length <= 12 && url.pathname.length <= 1024
        ? `/${segments.map((segment) => (journalPathSegments.has(segment) || owned.has(segment) ? segment : "[redacted]")).join("/")}`
        : "/[redacted]"
    const allKeys = [...new Set(url.searchParams.keys())]
    const queryKeys = [
      ...new Set(
        allKeys.slice(0, 32).map((key) => {
          const parsed =
            /^([a-z_]+)(?:\[(?:\d{0,2}|\$gt|\$gte|\$lt|\$lte|\$eq|\$ne|\$in)\])?$/u.exec(
              key
            )
          return parsed && journalQueryNames.has(parsed[1]) ? key : "[redacted]"
        })
      ),
    ].sort()
    return {
      method,
      pathname,
      queryKeys,
      queryKeysOverflow: allKeys.length > 32,
    }
  } catch {
    return {
      method,
      pathname: "/[redacted]",
      queryKeys: [],
      queryKeysOverflow: false,
    }
  }
}

// Puppeteer serializes this function. It only reads native tooltip geometry,
// styles and animation state; no text, focus, DOM, media or theme is changed.
export const captureNativeSettingsTooltips = async () => {
  await new Promise((done) => requestAnimationFrame(done))
  const nodes = [...document.querySelectorAll(".shadow-elevation-tooltip")]
  // Radix Presence retains closed content through its exit animation. Only
  // count an over-bound frame; do not traverse its styles or accept it as final.
  if (nodes.length > 8)
    return { kind: "native-tooltip-count-over-bound", count: nodes.length }
  return nodes.map((node) => {
    const style = getComputedStyle(node),
      rect = node.getBoundingClientRect()
    let effectiveOpacity = 1,
      ancestor = node,
      ancestorCount = 0
    while (ancestor) {
      if (++ancestorCount > 64)
        throw new Error("Native tooltip ancestor bound exceeded")
      effectiveOpacity *= Number(getComputedStyle(ancestor).opacity)
      ancestor = ancestor.parentElement
    }
    const animations = node
      .getAnimations({ subtree: true })
      .filter((animation) =>
        ["running", "pending"].includes(animation.playState)
      )
    return {
      state: node.getAttribute("data-state"),
      opacity: Number(style.opacity),
      effectiveOpacity,
      color: style.color,
      backgroundColor: style.backgroundColor,
      transform: style.transform,
      display: style.display,
      visibility: style.visibility,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      activeAnimations: animations.length,
      infiniteAnimations: animations.filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations === Infinity
      ).length,
    }
  })
}

export const settleNativeSettingsTooltips = async (
  page,
  {
    timeoutMs = 2000,
    quietMs = 300,
    pollMs = 16,
    now = () => Date.now(),
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {}
) => {
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2000
  )
  assert.ok(
    Number.isSafeInteger(quietMs) && quietMs >= 0 && quietMs < timeoutMs
  )
  assert.ok(Number.isSafeInteger(pollMs) && pollMs > 0 && pollMs <= 50)
  const started = now(),
    samples = []
  let previous = null,
    stableFrames = 0,
    quietStarted = null,
    initialCount = null,
    maximumCount = 0,
    overBoundFrames = 0,
    lastCount = null
  try {
    while (now() - started < timeoutMs) {
      if (samples.length >= 128)
        throw new Error("Native tooltip sample bound exceeded")
      let timer
      const remaining = timeoutMs - (now() - started)
      const sample = await Promise.race([
        page.evaluate(captureNativeSettingsTooltips),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native tooltip sampling timed out")),
            remaining
          )
        }),
      ]).finally(() => clearTimeout(timer))
      const elapsedMs = now() - started
      assert.ok(elapsedMs < timeoutMs, "Native tooltip sampling timed out")
      samples.push({ elapsedMs, tooltips: sample })
      if (record(sample)) {
        assert.deepEqual(Object.keys(sample).sort(), ["count", "kind"])
        assert.equal(sample.kind, "native-tooltip-count-over-bound")
        assert.ok(Number.isSafeInteger(sample.count) && sample.count > 8)
        initialCount ??= sample.count
        maximumCount = Math.max(maximumCount, sample.count)
        lastCount = sample.count
        overBoundFrames += 1
        previous = null
        stableFrames = 0
        quietStarted = null
        await sleep(
          Math.min(pollMs, Math.max(1, timeoutMs - (now() - started)))
        )
        continue
      }
      assert.ok(
        Array.isArray(sample) && sample.length <= 8,
        "Malformed native tooltip sample"
      )
      initialCount ??= sample.length
      maximumCount = Math.max(maximumCount, sample.length)
      lastCount = sample.length
      for (const tooltip of sample) {
        assert.ok(record(tooltip) && record(tooltip.rect))
        assert.ok(
          [null, "instant-open", "delayed-open", "closed"].includes(
            tooltip.state
          ),
          "Unknown native tooltip state"
        )
        assert.ok(
          [tooltip.opacity, tooltip.effectiveOpacity].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1
          )
        )
        assert.ok(Object.values(tooltip.rect).every(Number.isFinite))
        assert.ok(
          [
            tooltip.color,
            tooltip.backgroundColor,
            tooltip.transform,
            tooltip.display,
            tooltip.visibility,
          ].every((value) => typeof value === "string" && value.length <= 256)
        )
        assert.ok(
          Number.isSafeInteger(tooltip.activeAnimations) &&
            tooltip.activeAnimations >= 0 &&
            tooltip.activeAnimations <= 64
        )
        assert.equal(
          tooltip.infiniteAnimations,
          0,
          "Native tooltip has an infinite animation"
        )
      }
      const current = JSON.stringify(sample),
        stationary = sample.every((tooltip) => tooltip.activeAnimations === 0)
      stableFrames = stationary && previous === current ? stableFrames + 1 : 0
      if (!stationary) quietStarted = null
      else if (previous !== current || quietStarted === null)
        quietStarted = now()
      previous = current
      if (
        stationary &&
        stableFrames >= 2 &&
        quietStarted !== null &&
        now() - quietStarted >= quietMs
      ) {
        return {
          elapsedMs: now() - started,
          stableFrames,
          quietMs,
          samples,
          final: sample,
          counts: {
            initial: initialCount,
            maximum: maximumCount,
            final: sample.length,
            overBoundFrames,
          },
          changedNativeUi: false,
        }
      }
      await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (now() - started))))
    }
    const error = new Error(
      lastCount > 8
        ? "Native tooltip count exceeded bound"
        : "Native tooltip visuals did not stabilize within bound"
    )
    error.tooltipSamples = samples
    throw error
  } catch (error) {
    error.tooltipSamples = samples
    throw error
  }
}

// Serialized into the native page. Observe without changing its DOM or styles.
export const captureNativeSettingsControl = async (node) => {
  await new Promise((done) => requestAnimationFrame(done))
  if (!node.isConnected) throw new Error("Native control is disconnected")
  const tags = [
      "BUTTON",
      "DIV",
      "SPAN",
      "A",
      "INPUT",
      "MAIN",
      "HEADER",
      "TABLE",
      "TR",
      "TD",
      "TH",
      "BODY",
      "HTML",
      "SVG",
      "PATH",
    ],
    roles = [
      "button",
      "checkbox",
      "menu",
      "menuitem",
      "menuitemradio",
      "dialog",
      "alertdialog",
      "tooltip",
      "region",
    ],
    classes = [
      "sticky",
      "fixed",
      "absolute",
      "relative",
      "overflow-hidden",
      "pointer-events-none",
      "pointer-events-auto",
      "shadow-elevation-tooltip",
    ]
  const identity = (element) =>
    element
      ? {
          tag: tags.includes(element.tagName.toUpperCase())
            ? element.tagName.toUpperCase()
            : "OTHER",
          role: roles.includes(element.getAttribute("role"))
            ? element.getAttribute("role")
            : null,
          classes: classes.filter((name) => element.classList.contains(name)),
        }
      : null
  const styleOf = (element) => {
    const style = getComputedStyle(element)
    return {
      pointerEvents: ["auto", "none"].includes(style.pointerEvents)
        ? style.pointerEvents
        : "OTHER",
      position: ["static", "relative", "absolute", "fixed", "sticky"].includes(
        style.position
      )
        ? style.position
        : "OTHER",
      zIndex: /^(auto|-?\d{1,9})$/u.test(style.zIndex) ? style.zIndex : "OTHER",
      opacity: Number(style.opacity),
      transform:
        /^(none|matrix(?:3d)?\([\d\s.,e+-]+\))$/u.test(style.transform) &&
        style.transform.length <= 256
          ? style.transform
          : "OTHER",
      display: [
        "none",
        "block",
        "inline",
        "inline-block",
        "flex",
        "inline-flex",
        "grid",
        "table",
        "table-row",
        "table-cell",
        "contents",
      ].includes(style.display)
        ? style.display
        : "OTHER",
      visibility: ["visible", "hidden", "collapse"].includes(style.visibility)
        ? style.visibility
        : "OTHER",
      cursor: [
        "pointer",
        "default",
        "auto",
        "not-allowed",
        "text",
        "wait",
        "progress",
      ].includes(style.cursor)
        ? style.cursor
        : "OTHER",
    }
  }
  const ancestors = (element) => {
    const result = []
    while (element && result.length < 8) {
      result.push({ ...identity(element), style: styleOf(element) })
      element = element.parentElement
    }
    return result
  }
  const rect = node.getBoundingClientRect(),
    hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    ),
    animations = [],
    style = styleOf(node)
  let ancestor = node
  for (
    let depth = 0;
    ancestor && depth < 8;
    depth++, ancestor = ancestor.parentElement
  )
    animations.push(
      ...ancestor
        .getAnimations()
        .filter((animation) =>
          ["running", "pending"].includes(animation.playState)
        )
    )
  if (animations.length > 64)
    throw new Error("Native control animation bound exceeded")
  return {
    ...identity(node),
    type: [
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "text",
      "search",
    ].includes(node.getAttribute("type"))
      ? node.getAttribute("type")
      : null,
    cursor: style.cursor,
    disabled:
      node.matches(":disabled") ||
      node.getAttribute("aria-disabled") === "true",
    fullyVisible:
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= innerWidth &&
      rect.bottom <= innerHeight,
    centreHit: hit === node || (!!hit && node.contains(hit)),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY },
    style,
    hit: identity(hit),
    hitAncestors: ancestors(hit),
    controlAncestors: ancestors(node),
    activeAnimations: animations.length,
    infiniteAnimations: animations.filter(
      (animation) =>
        animation.effect?.getComputedTiming().iterations === Infinity
    ).length,
  }
}

export const assertNativeSettingsControl = async (
  control,
  {
    timeoutMs = 2000,
    quietMs = 100,
    pollMs = 16,
    now = () => Date.now(),
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    prepare,
  } = {}
) => {
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2000
  )
  assert.ok(
    Number.isSafeInteger(quietMs) && quietMs >= 0 && quietMs < timeoutMs
  )
  assert.ok(Number.isSafeInteger(pollMs) && pollMs > 0 && pollMs <= 50)
  assert.ok(prepare === undefined || typeof prepare === "function")
  const started = now(),
    samples = []
  let previous,
    stableFrames = 0,
    quietStarted,
    phase = prepare ? "prepare" : "final",
    preparation
  try {
    while (now() - started < timeoutMs) {
      if (samples.length >= 128)
        throw new Error("Native control sample bound exceeded")
      let timer
      const sample = await Promise.race([
        control.evaluate(captureNativeSettingsControl),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Native control sampling timed out")),
            timeoutMs - (now() - started)
          )
        }),
      ]).finally(() => clearTimeout(timer))
      if (now() - started >= timeoutMs)
        throw new Error("Native control sampling exceeded overall bound")
      assert.ok(
        record(sample) &&
          record(sample.rect) &&
          record(sample.viewport) &&
          record(sample.scroll)
      )
      assert.ok(
        [
          ...Object.values(sample.rect),
          ...Object.values(sample.viewport),
          ...Object.values(sample.scroll),
        ].every(Number.isFinite)
      )
      assert.ok(
        Array.isArray(sample.hitAncestors) &&
          sample.hitAncestors.length <= 8 &&
          Array.isArray(sample.controlAncestors) &&
          sample.controlAncestors.length <= 8
      )
      assert.ok(
        [sample.disabled, sample.fullyVisible, sample.centreHit].every(
          (value) => typeof value === "boolean"
        )
      )
      assert.ok(
        Number.isSafeInteger(sample.activeAnimations) &&
          sample.activeAnimations >= 0 &&
          sample.activeAnimations <= 64
      )
      assert.equal(
        sample.infiniteAnimations,
        0,
        "Native control has an infinite animation"
      )
      samples.push({
        elapsedMs: now() - started,
        ...(prepare ? { phase } : {}),
        control: sample,
      })
      const current = JSON.stringify(sample),
        stationary = sample.activeAnimations === 0
      stableFrames = stationary && current === previous ? stableFrames + 1 : 0
      if (prepare && (!stationary || current !== previous))
        quietStarted = stationary ? now() : undefined
      previous = current
      const quiet = prepare
        ? quietStarted !== undefined && now() - quietStarted >= quietMs
        : now() - started >= quietMs
      if (stationary && stableFrames >= 2 && quiet) {
        if (phase === "prepare") {
          const remainingMs = timeoutMs - (now() - started)
          if (remainingMs <= 0)
            throw new Error("Native control preparation exceeded overall bound")
          preparation = { startedAtMs: now() - started, invocations: 1 }
          let preparationTimer
          await Promise.race([
            Promise.resolve().then(prepare),
            new Promise((_, reject) => {
              preparationTimer = setTimeout(
                () => reject(new Error("Native control preparation timed out")),
                remainingMs
              )
            }),
          ]).finally(() => clearTimeout(preparationTimer))
          if (now() - started >= timeoutMs)
            throw new Error("Native control preparation exceeded overall bound")
          preparation.completedAtMs = now() - started
          phase = "final"
          previous = undefined
          stableFrames = 0
          quietStarted = undefined
          continue
        }
        assert.equal(
          sample.disabled,
          false,
          "Native audit action must be enabled"
        )
        assert.equal(
          sample.fullyVisible,
          true,
          "Native audit action is clipped"
        )
        assert.equal(sample.centreHit, true, "Native audit action is occluded")
        assert.equal(
          sample.cursor,
          "pointer",
          "Native audit action must show the interactive cursor"
        )
        return {
          ...sample,
          stability: {
            elapsedMs: now() - started,
            stableFrames,
            quietMs,
            samples,
            ...(prepare ? { preparation } : {}),
            changedNativeUi: false,
          },
        }
      }
      await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (now() - started))))
    }
    throw new Error("Native control geometry did not stabilize within bound")
  } catch (error) {
    error.nativeControlProof = {
      samples,
      ...(prepare ? { preparation, phase } : {}),
      changedNativeUi: false,
    }
    throw error
  }
}

export const closeSettingsResources = async (actions, timeoutMs = 10_000) => {
  assert.ok(
    Array.isArray(actions) &&
      actions.every(
        ([name, close]) =>
          typeof name === "string" && typeof close === "function"
      )
  )
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000
  )
  const receipts = []
  for (const [name, close] of actions) {
    let timer
    try {
      await Promise.race([
        Promise.resolve().then(close),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Owned Settings cleanup exceeded ${timeoutMs}ms`)
              ),
            timeoutMs
          )
        }),
      ])
      receipts.push({ name, status: "passed" })
    } catch (error) {
      receipts.push({
        name,
        status: "failed",
        error: { name: error.name, message: error.message },
      })
    } finally {
      clearTimeout(timer)
    }
  }
  return receipts
}

export const validateSettingsBrowserRoots = async ({
  adminRoot,
  artifactRoot,
  repositoryRoot,
}) => {
  for (const path of [adminRoot, artifactRoot, repositoryRoot]) {
    assert.ok(isAbsolute(path) && !path.split(sep).includes("Default"))
    assert.equal(resolve(path), path, "Evidence roots must be canonical paths")
  }
  const repository = await realpath(repositoryRoot)
  assert.equal(repository, repositoryRoot)
  const artifacts = resolve(repository, "artifacts")
  assert.equal(await realpath(artifacts), artifacts)
  assert.ok((await lstat(artifacts)).isDirectory())
  for (const path of [adminRoot, artifactRoot]) {
    assert.ok(
      path.startsWith(`${artifacts}${sep}`),
      "Browser roots must be private artifacts"
    )
    let existing = path
    while (true) {
      try {
        const stat = await lstat(existing)
        assert.ok(!stat.isSymbolicLink() && stat.isDirectory())
        assert.equal(await realpath(existing), existing)
        break
      } catch (error) {
        if (error.code !== "ENOENT") throw error
        existing = dirname(existing)
      }
    }
  }
  assert.ok(
    (await lstat(adminRoot)).isDirectory(),
    "Compiled Admin root must exist"
  )
  assert.equal(await realpath(adminRoot), adminRoot)
}

export const validateSettingsLoopbackOrigin = (raw) => {
  const url = new URL(raw)
  assert.equal(url.protocol, "http:", "Settings transport must use local HTTP")
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "Settings transport must use literal loopback"
  )
  assert.ok(
    Number(url.port) >= 1024 && Number(url.port) <= 65535,
    "Invalid owned port"
  )
  assert.equal(url.origin, raw, "Origin must have no path/query/credentials")
  return url
}

const readablePath = (method, pathname, parameters, owned) => {
  const shell = nativeShellReadMatches(method, pathname, parameters)
  if (shell !== null) return shell
  if (
    [
      "/admin/users/me",
      "/admin/rbac/me/permissions",
      "/admin/feature-flags",
      "/cloud/auth",
      "/admin/notifications/feed",
      "/admin/payments/payment-providers",
    ].includes(pathname)
  )
    return true
  const parts = pathname.split("/").slice(1)
  if (parts[0] !== "admin") return false
  if (parts[1] === "rbac") {
    if (!["roles", "policies"].includes(parts[2])) return false
    if (parts.length === 3) return true
    if (parts.length === 4 && parts[3] === "assignable") return true
    return (
      owned.has(parts[3]) &&
      (parts.length === 4 ||
        (parts.length === 5 &&
          ["policies", "users", "roles"].includes(parts[4])))
    )
  }
  if (!entities.has(parts[1])) return false
  if (parts.length === 2) return true
  if (parts[1] === "currencies" && parts.length === 3)
    return /^(usd|eur)$/u.test(parts[2])
  return (
    owned.has(parts[2]) &&
    (parts.length === 3 ||
      (parts[1] === "users" &&
        parts.length <= 5 &&
        parts[3] === "roles" &&
        (!parts[4] || owned.has(parts[4]))))
  )
}

const mutablePath = (method, pathname, owned) => {
  const parts = pathname.split("/").slice(1)
  if (parts[0] !== "admin") return false
  if (parts[1] === "rbac") {
    // Policies remain read-only in the reachable native Dashboard.
    if (parts[2] !== "roles") return false
    if (parts.length === 3) return method === "POST"
    if (!owned.has(parts[3])) return false
    if (parts.length === 4) return true
    return (
      ["policies", "users"].includes(parts[4]) &&
      (parts.length === 5 ||
        (method === "DELETE" && parts.length === 6 && owned.has(parts[5])))
    )
  }
  if (!mutableEntities.has(parts[1]) || readOnlyCollections.has(parts[1]))
    return false
  if (parts.length === 2)
    return (
      method === "POST" &&
      ["regions", "tax-regions", "tax-rates"].includes(parts[1])
    )
  if (!owned.has(parts[2])) return false
  if (parts.length === 3) return method !== "DELETE" || parts[1] !== "stores"
  return (
    parts[1] === "users" &&
    parts[3] === "roles" &&
    (parts.length === 4 ||
      (method === "DELETE" && parts.length === 5 && owned.has(parts[4])))
  )
}

const validateQuery = (searchParams, owned, pathname) => {
  for (const [key, value] of searchParams) {
    if (key.length > 80 || value.length > 4096) return false
    if (/^(id|user_id|role_id|parent_id|tax_region_id)(\[\d*\])?$/u.test(key)) {
      if (
        pathname === "/admin/tax-regions" &&
        key === "parent_id" &&
        value === "null"
      )
        continue
      if (!owned.has(value)) return false
    }
  }
  return true
}

const ownedBody = (body, owned, providers) => {
  if (body === undefined) return true
  if (!record(body)) return false
  for (const key of [
    "default_region_id",
    "default_sales_channel_id",
    "default_location_id",
    "parent_id",
    "tax_region_id",
  ]) {
    if (body[key] != null && !owned.has(body[key])) return false
  }
  for (const key of ["users", "roles", "policies", "policy_ids"]) {
    if (
      body[key] !== undefined &&
      (!Array.isArray(body[key]) || body[key].some((id) => !owned.has(id)))
    )
      return false
  }
  if (body.provider_id != null && !providers.has(body.provider_id)) return false
  if (
    body.payment_providers !== undefined &&
    (!Array.isArray(body.payment_providers) ||
      body.payment_providers.some((id) => !providers.has(id)))
  )
    return false
  if (
    body.rules !== undefined &&
    (!Array.isArray(body.rules) ||
      body.rules.some((rule) => !record(rule) || !owned.has(rule.reference_id)))
  )
    return false
  return true
}

const collect = async (stream, limit) => {
  const chunks = []
  let bytes = 0
  for await (const chunk of stream) {
    bytes += chunk.length
    if (bytes > limit)
      throw new Error("Settings transport byte budget exceeded")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const forward = ({
  upstream,
  path,
  method,
  headers,
  body,
  timeoutMs,
  agent,
  upstreamRequests,
  upstreamSockets,
}) =>
  new Promise((resolvePromise, reject) => {
    let settled = false
    let deadline
    const settle = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (error) reject(error)
      else resolvePromise(value)
    }
    const request = httpRequest(
      {
        // Keep request path/query text separate from the fixed owned authority.
        hostname: "127.0.0.1",
        port: upstream.port,
        path,
        method,
        headers,
        agent,
      },
      async (response) => {
        try {
          settle(null, {
            status: response.statusCode,
            headers: response.headers,
            body: await collect(response, responseLimit),
          })
        } catch (error) {
          request.destroy()
          settle(error)
        }
      }
    )
    upstreamRequests.add(request)
    request.once("close", () => upstreamRequests.delete(request))
    request.once("socket", (socket) => {
      if (!upstreamSockets.has(socket)) {
        upstreamSockets.add(socket)
        socket.once("close", () => upstreamSockets.delete(socket))
      }
    })
    deadline = setTimeout(() => {
      const error = new Error("Settings native transport timed out")
      request.destroy(error)
      settle(error)
    }, timeoutMs)
    request.on("error", (error) => settle(error))
    if (body.length) request.write(body)
    request.end()
  })

export const startNativeSettingsLoopbackProxy = async ({
  upstreamOrigin,
  staticRoot,
  staticHashes,
  ownedIds,
  actors,
  providerIds = [],
  staticResponseHeaders = {},
  timeoutMs = 15_000,
}) => {
  const upstream = validateSettingsLoopbackOrigin(upstreamOrigin)
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30_000
  )
  assert.ok(Array.isArray(ownedIds) && ownedIds.every(safeId))
  assert.ok(Array.isArray(actors) && actors.length > 0)
  assert.ok(
    actors.every(
      (actor) =>
        safeId(actor.id) &&
        typeof actor.email === "string" &&
        typeof actor.password === "string" &&
        actor.password.length > 0
    )
  )
  assert.ok(Array.isArray(providerIds) && providerIds.every(safeId))
  assert.ok(record(staticResponseHeaders))
  assert.ok(
    Object.keys(staticResponseHeaders).every((name) =>
      [
        "content-security-policy",
        "cross-origin-opener-policy",
        "permissions-policy",
        "referrer-policy",
        "x-content-type-options",
        "x-frame-options",
      ].includes(name)
    )
  )
  assert.ok(
    Object.values(staticResponseHeaders).every(
      (value) => typeof value === "string" && !/[\r\n]/u.test(value)
    )
  )
  assert.ok(
    record(staticHashes) && /^[a-f0-9]{64}$/u.test(staticHashes["index.html"])
  )
  const pinnedHashes = Object.freeze({ ...staticHashes })
  for (const [name, digest] of Object.entries(pinnedHashes)) {
    assert.ok(
      /^[a-f0-9]{64}$/u.test(digest) && /^[A-Za-z0-9_./-]+$/u.test(name)
    )
    assert.ok(
      !name
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || part === "Default"
        )
    )
  }
  assert.ok(!resolve(staticRoot).split(sep).includes("Default"))
  const root = await realpath(staticRoot)
  assert.ok(
    !root.split(sep).includes("Default") && (await lstat(root)).isDirectory()
  )
  const knownActors = Object.freeze(
    actors.map((actor) => Object.freeze({ ...actor }))
  )
  const owned = new Set(ownedIds)
  const providers = new Set(providerIds)
  const receipts = []
  const sockets = new Set()
  const upstreamRequests = new Set()
  const upstreamSockets = new Set()
  const upstreamAgent = new Agent({
    keepAlive: false,
    maxSockets: 16,
    maxTotalSockets: 16,
  })
  const mintedTokens = new Map()
  const active = new Set()
  let origin
  let intent = null
  let fault = null
  let closed = false
  let closePromise
  const server = createServer(async (request, response) => {
    const deny = (response, status, code, evidence = {}) => {
      receipts.push({
        kind: "denied",
        status,
        code,
        ...settingsDeniedTarget(request, origin, owned),
        ...evidence,
      })
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      response.end(JSON.stringify({ code }))
    }
    const operation = (async () => {
      try {
        if (closed) return deny(response, 503, "settings_transport_closed")
        const url = new URL(request.url, origin)
        const method = request.method
        if (
          url.origin !== origin ||
          !methods.has(method) ||
          request.headers.host !== new URL(origin).host ||
          /%2f|%5c|\/\.|\\/iu.test(request.url)
        )
          return deny(response, 403, "settings_transport_target_denied")
        if (request.headers.origin && request.headers.origin !== origin)
          return deny(response, 403, "settings_transport_origin_denied")
        if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
          if (!["GET", "HEAD"].includes(method))
            return deny(response, 403, "settings_static_method_denied")
          const relative = url.pathname.startsWith("/app/assets/")
            ? decodeURIComponent(url.pathname.slice(5))
            : "index.html"
          if (!Object.hasOwn(pinnedHashes, relative))
            return deny(response, 404, "settings_static_unknown")
          const filename = resolve(root, relative)
          const bytes = await readPinnedNativeAsset(root, relative)
          if (bytes === null)
            return deny(response, 403, "settings_static_path_denied")
          if (hash(bytes) !== pinnedHashes[relative])
            return deny(response, 409, "settings_static_hash_changed")
          response.writeHead(200, {
            ...staticResponseHeaders,
            "content-type":
              mediaTypes[extname(filename)] ?? "application/octet-stream",
            "cache-control": "no-store",
          })
          return response.end(method === "HEAD" ? undefined : bytes)
        }
        if (!validateQuery(url.searchParams, owned, url.pathname))
          return deny(response, 403, "settings_query_scope_denied")
        const bytes = await collect(request, bodyLimit)
        const parsed = bytes.length
          ? JSON.parse(bytes.toString("utf8"))
          : undefined
        const auth =
          url.pathname === "/auth/user/emailpass" ||
          url.pathname === "/auth/session"
        let command = null
        let loginActor = null
        if (auth) {
          if (url.search || !["POST", "DELETE"].includes(method))
            return deny(response, 403, "settings_auth_scope_denied")
          if (url.pathname === "/auth/user/emailpass") {
            if (
              method !== "POST" ||
              !record(parsed) ||
              Object.keys(parsed).sort().join(",") !== "email,password" ||
              !(loginActor = knownActors.find((actor) => {
                if (
                  parsed.email !== actor.email ||
                  typeof parsed.password !== "string"
                )
                  return false
                const actual = Buffer.from(parsed.password)
                const expected = Buffer.from(actor.password)
                return (
                  actual.length === expected.length &&
                  timingSafeEqual(actual, expected)
                )
              }))
            )
              return deny(response, 403, "settings_actor_login_denied")
          } else if (
            bytes.length ||
            (method === "POST" &&
              !mintedTokens.has(request.headers.authorization))
          )
            return deny(response, 403, "settings_session_scope_denied")
        } else if (["GET", "HEAD"].includes(method)) {
          if (
            bytes.length ||
            !readablePath(method, url.pathname, url.searchParams, owned)
          )
            return deny(response, 403, "settings_read_scope_denied")
        } else {
          const mutable = mutablePath(method, url.pathname, owned)
          if (
            url.search ||
            !mutable ||
            !intent ||
            intent.method !== method ||
            intent.path !== url.pathname ||
            canonical(parsed) !== intent.body
          )
            return deny(response, 403, "settings_write_intent_denied", {
              writeMismatch: writeMismatchEvidence(
                intent,
                parsed,
                bytes,
                method,
                url.pathname,
                !url.search,
                mutable
              ),
            })
          command = intent
          intent = null
        }
        const headers = {}
        for (const key of headerNames)
          if (request.headers[key]) headers[key] = request.headers[key]
        if (bytes.length) headers["content-length"] = String(bytes.length)
        if (closed) return deny(response, 503, "settings_transport_closed")
        const native = await forward({
          upstream,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          body: bytes,
          timeoutMs,
          agent: upstreamAgent,
          upstreamRequests,
          upstreamSockets,
        })
        if (loginActor && native.status === 200) {
          const token = JSON.parse(native.body.toString("utf8"))?.token
          assert.ok(
            typeof token === "string" && /^[\w.-]{20,8192}$/u.test(token),
            "Native owned login must mint its session token"
          )
          mintedTokens.set(`Bearer ${token}`, loginActor.id)
        }
        const entry = {
          kind: auth ? "authentication" : "native",
          method,
          path: url.pathname,
          status: native.status,
          ...(auth
            ? { authPayload: "redacted" }
            : {
                query: [...url.searchParams.entries()],
                requestBodySha256: hash(bytes),
                responseBodySha256: hash(native.body),
              }),
        }
        receipts.push(entry)
        if (
          command &&
          native.status >= 200 &&
          native.status < 300 &&
          command.responseEntity
        ) {
          const payload = JSON.parse(native.body.toString("utf8"))
          const row = payload?.[command.responseEntity]
          if (!safeId(row?.id))
            throw new Error("Native created Settings response lacked an ID")
          owned.add(row.id)
          entry.createdId = row.id
        }
        const responseHeaders = {}
        for (const key of ["content-type", "set-cookie", "cache-control"])
          if (native.headers[key]) responseHeaders[key] = native.headers[key]
        if (fault && fault.method === method && fault.path === url.pathname) {
          const selected = fault
          fault = null
          entry.transportFault = selected.kind
          if (selected.kind === "drop-response") {
            entry.transportFaultApplied =
              native.status >= 200 && native.status < 300
            if (entry.transportFaultApplied) {
              assert.ok(native.body.length > 1)
              // Deliver the real status, then lose the body acknowledgement.
              // A reset before headers can cause a browser transport replay.
              entry.transportResponseExpectedBytes = native.body.length
              entry.transportResponseSentBytes = 1
              response.writeHead(native.status, {
                ...responseHeaders,
                "content-length": String(native.body.length),
                connection: "close",
              })
              return response.end(native.body.subarray(0, 1))
            }
          } else {
            entry.transportResponseHeld = true
            await new Promise((done) => setTimeout(done, selected.delayMs))
            entry.transportResponseHeld = false
          }
        }
        if (closed || response.destroyed) return
        response.writeHead(native.status, responseHeaders)
        response.end(method === "HEAD" ? undefined : native.body)
      } catch {
        if (!response.destroyed && !response.headersSent)
          deny(response, 502, "settings_transport_failed")
        else response.destroy()
      }
    })()
    active.add(operation)
    void operation.finally(() => active.delete(operation))
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  await new Promise((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    receipts,
    owned,
    transportState: () => ({
      closed,
      activeOperations: active.size,
      clientSockets: sockets.size,
      upstreamRequests: upstreamRequests.size,
      upstreamSockets: upstreamSockets.size,
      agentActiveSockets: Object.values(upstreamAgent.sockets).reduce(
        (count, entries) => count + entries.length,
        0
      ),
      agentIdleSockets: Object.values(upstreamAgent.freeSockets).reduce(
        (count, entries) => count + entries.length,
        0
      ),
      agentQueuedRequests: Object.values(upstreamAgent.requests).reduce(
        (count, entries) => count + entries.length,
        0
      ),
    }),
    arm: ({ method, path, body, responseEntity }) => {
      assert.ok(!closed && !intent, "A Settings write is already pending")
      assert.ok(
        ["POST", "DELETE"].includes(method) && mutablePath(method, path, owned),
        "Write scope is not allowed"
      )
      assert.ok(
        ownedBody(body, owned, providers),
        "Write relationship is outside owned fixture scope"
      )
      assert.ok(Buffer.byteLength(canonical(body) ?? "") <= bodyLimit)
      assert.ok(
        !responseEntity ||
          {
            "/admin/rbac/roles": "role",
            "/admin/regions": "region",
            "/admin/tax-regions": "tax_region",
            "/admin/tax-rates": "tax_rate",
          }[path] === responseEntity
      )
      intent = {
        method,
        path,
        body: canonical(
          body === undefined ? undefined : JSON.parse(JSON.stringify(body))
        ),
        responseEntity,
      }
    },
    faultOnce: ({ method, path, kind, delayMs = 250 }) => {
      assert.ok(!closed && !fault && ["GET", "POST"].includes(method))
      assert.ok(kind === "delay" || kind === "drop-response")
      assert.ok(
        Number.isSafeInteger(delayMs) && delayMs >= 1 && delayMs <= 5000
      )
      assert.ok(
        method === "GET"
          ? path === "/admin/rbac/me/permissions"
          : intent?.path === path && intent.method === method
      )
      fault = { method, path, kind, delayMs }
    },
    close: () => {
      closePromise ??= (async () => {
        closed = true
        intent = null
        fault = null
        mintedTokens.clear()
        const socketClosures = [...sockets, ...upstreamSockets].map(
          (socket) =>
            new Promise((done) => {
              socket.once("close", done)
              socket.destroy()
            })
        )
        const requestClosures = [...upstreamRequests].map(
          (request) =>
            new Promise((done) => {
              request.once("close", done)
              request.destroy(new Error("Owned Settings transport closed"))
            })
        )
        upstreamAgent.destroy()
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done()))
        )
        await Promise.allSettled([...active])
        await Promise.all(socketClosures)
        await Promise.all(requestClosures)
        assert.equal(sockets.size, 0, "Settings proxy sockets remain")
        assert.equal(
          upstreamRequests.size,
          0,
          "Settings upstream requests remain"
        )
        assert.equal(
          upstreamSockets.size,
          0,
          "Settings upstream sockets remain"
        )
        assert.equal(active.size, 0, "Settings proxy operations remain")
        assert.equal(Object.keys(upstreamAgent.sockets).length, 0)
        assert.equal(Object.keys(upstreamAgent.freeSockets).length, 0)
        assert.equal(Object.keys(upstreamAgent.requests).length, 0)
      })()
      return closePromise
    },
  }
}

export const createNativeSettingsNavigationIdle = async (
  page,
  observe = () => {}
) => {
  const session = await page.createCDPSession()
  const active = new Map()
  const lifecycle = new Map()
  let disposed = false
  let fatal = null
  let busy = false
  let loadObserved = false
  let zeroSince = null
  let totalStarted = 0
  let totalFinished = 0
  let totalFailed = 0
  let timer = null
  let evaluateIdle = null
  let lastProof = null
  const inspect = (stage) =>
    observe({
      stage,
      activeRequests: [...active.values()],
      activeSize: active.size,
      disposed,
      busy,
      loadObserved,
      zeroSince,
      observedAt: performance.now(),
      totalStarted,
      totalFinished,
      totalFailed,
      fatalName: fatal?.name ?? null,
    })
  const fail = (message) => {
    fatal ??= new Error(message)
    evaluateIdle?.()
  }
  const request = (event) => {
    const id = event?.requestId
    if (
      typeof id !== "string" ||
      !id ||
      !event.request ||
      typeof event.request !== "object"
    ) {
      fail("Native navigation Network request lifecycle is invalid")
      return
    }
    if (event.redirectResponse !== undefined) {
      if (
        !event.redirectResponse ||
        typeof event.redirectResponse !== "object" ||
        !active.delete(id) ||
        lifecycle.get(id) !== "active"
      ) {
        fail("Native navigation redirect has no unique active request")
        return
      }
      totalFinished += 1
    } else if (lifecycle.has(id)) {
      fail("Native navigation request lifecycle started twice or is invalid")
      return
    }
    lifecycle.set(id, "active")
    active.set(id, {
      requestId: id,
      url: event.request.url,
      method: event.request.method,
      resourceType: event.type ?? "Other",
      frameId: event.frameId ?? null,
    })
    totalStarted += 1
    zeroSince = null
    evaluateIdle?.()
  }
  const terminal = (kind) => (event) => {
    const id = event?.requestId
    if (
      typeof id !== "string" ||
      !id ||
      lifecycle.get(id) !== "active" ||
      !active.delete(id)
    ) {
      fail("Native navigation request terminal has no unique active request")
      return
    }
    lifecycle.set(id, kind)
    if (kind === "finished") totalFinished += 1
    else totalFailed += 1
    if (active.size === 0) zeroSince = performance.now()
    evaluateIdle?.()
  }
  const finished = terminal("finished")
  const failed = terminal("failed")
  const load = () => {
    if (busy) loadObserved = true
    evaluateIdle?.()
  }
  const closed = () => {
    if (busy)
      fail("Native navigation page closed before body-complete readiness")
  }
  // CDP Network IDs identify actual network bodies. Fetch-only interception
  // jobs have no Network lifecycle; no URL, protocol, frame or type is excluded.
  session.on("Network.requestWillBeSent", request)
  session.on("Network.loadingFinished", finished)
  session.on("Network.loadingFailed", failed)
  page.on("load", load)
  page.on("close", closed)
  const removeListeners = () => {
    session.off("Network.requestWillBeSent", request)
    session.off("Network.loadingFinished", finished)
    session.off("Network.loadingFailed", failed)
    page.off("load", load)
    page.off("close", closed)
  }
  try {
    await session.send("Network.enable")
    assert.equal(
      session.detached,
      false,
      "Native navigation Network session detached during initialization"
    )
  } catch (problem) {
    disposed = true
    removeListeners()
    try {
      await session.detach()
    } catch {
      /* Preserve the enable error. */
    }
    throw problem
  }
  const run = async (kind, url) => {
    assert.ok(!disposed && !busy && !page.isClosed())
    assert.equal(
      session.detached,
      false,
      "Native navigation Network session detached before navigation"
    )
    assert.equal(fatal, null)
    const timeoutMs = page.getDefaultNavigationTimeout()
    assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0)
    const startedAt = performance.now()
    const deadline = startedAt + timeoutMs
    const before = { totalStarted, totalFinished, totalFailed }
    const priorPendingAtStart = active.size > 0
    busy = true
    loadObserved = false
    zeroSince = null
    inspect("run-start")
    const waitForQuiet = async (requireLoad) => {
      try {
        await new Promise((resolve, reject) => {
          evaluateIdle = () => {
            clearTimeout(timer)
            timer = null
            const now = performance.now()
            if (session.detached)
              fatal ??= new Error(
                "Native navigation Network session detached before body-complete readiness"
              )
            if (fatal) {
              reject(fatal)
              return
            }
            if (now >= deadline) {
              inspect("deadline-timeout")
              reject(
                new Error(
                  `Native body-complete navigation exceeded ${timeoutMs}ms`
                )
              )
              return
            }
            const quietMs =
              active.size === 0 && zeroSince !== null ? now - zeroSince : 0
            if (
              (!requireLoad || loadObserved) &&
              active.size === 0 &&
              quietMs >= 500
            ) {
              if (requireLoad) {
                lastProof = {
                  kind,
                  timeoutMs,
                  elapsedMs: now - startedAt,
                  quietMs,
                  loadObserved,
                  activeRequests: active.size,
                  startedRequests: totalStarted - before.totalStarted,
                  finishedRequests: totalFinished - before.totalFinished,
                  failedRequests: totalFailed - before.totalFailed,
                  responseHeadersAffectCount: false,
                  lifecycleSource: "owned-CDP-Network",
                }
                inspect("idle-resolved")
              }
              resolve()
              return
            }
            const remainingQuiet =
              active.size === 0 && zeroSince !== null
                ? Math.max(1, 500 - quietMs)
                : deadline - now
            timer = setTimeout(
              evaluateIdle,
              Math.min(remainingQuiet, deadline - now)
            )
          }
          evaluateIdle()
        })
      } finally {
        clearTimeout(timer)
        timer = null
        evaluateIdle = null
      }
    }
    try {
      // Let previous-document bodies and their callback requests complete
      // before a hard navigation can abandon them. Both quiet periods and
      // native load share the one original navigation deadline.
      if (priorPendingAtStart) await waitForQuiet(false)
      loadObserved = false
      zeroSince = null
      const remainingTimeoutMs = deadline - performance.now()
      if (remainingTimeoutMs <= 0) {
        inspect("deadline-timeout")
        throw new Error(
          `Native body-complete navigation exceeded ${timeoutMs}ms`
        )
      }
      // Response/header events do not decrement count; only Network body
      // terminals or a real redirect do. Native load remains mandatory.
      const response =
        kind === "goto"
          ? await page.goto(url, {
              waitUntil: "load",
              timeout: remainingTimeoutMs,
            })
          : await page.reload({
              waitUntil: "load",
              timeout: remainingTimeoutMs,
            })
      inspect("native-load-returned")
      assert.ok(loadObserved, "Native navigation did not emit its load event")
      if (fatal) throw fatal
      await waitForQuiet(true)
      return response
    } finally {
      inspect("run-finally")
      clearTimeout(timer)
      timer = null
      evaluateIdle = null
      busy = false
    }
  }
  return {
    goto: (url) => run("goto", url),
    reload: () => run("reload"),
    proof: () => (lastProof ? { ...lastProof } : null),
    inspect: () => inspect("manual-read-only"),
    dispose: async () => {
      assert.ok(
        !busy,
        "Cannot dispose native readiness while navigation is pending"
      )
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      removeListeners()
      active.clear()
      evaluateIdle = null
      if (!session.detached) await session.detach()
      else
        fatal ??= new Error(
          "Native navigation Network session detached before readiness disposal"
        )
      if (fatal) throw fatal
    },
  }
}
