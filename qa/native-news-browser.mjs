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
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readNativeNewsSecurityHeaders,
  startNativeNewsLoopbackProxy,
} from "./lib/native-news-loopback-proxy.mjs"
import { trackNativeNewsBrowserProcess } from "./lib/native-news-browser-process.mjs"

const require = createRequire(new URL("../package.json", import.meta.url))
const puppeteer = require("puppeteer")
const { AxePuppeteer } = require("@axe-core/puppeteer")
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)])
        )
      : value
const commandHash = (value) => digest(JSON.stringify(canonical(value)))
const text = (value) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
const inputFor = (entry, status = "published", title = entry.title) => ({
  title,
  content: entry.content,
  excerpt: entry.excerpt,
  coverUrl: entry.coverUrl,
  coverAltText: entry.coverAltText,
  tags: entry.tags,
  publishedAt: status === "scheduled" ? entry.publishedAt : null,
  status,
})
const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)))
export const validateNewsBrowserDirectories = async (
  adminRoot,
  artifactRoot
) => {
  assert.ok(isAbsolute(adminRoot) && isAbsolute(artifactRoot))
  // Reject Default lexically before any filesystem lookup or inventory.
  for (const path of [adminRoot, artifactRoot])
    assert.ok(
      !resolve(path).split(sep).includes("Default"),
      "Default is outside the News fixture"
    )
  const repository = await realpath(repositoryRoot)
  const artifacts = join(repository, "artifacts")
  const admin = resolve(adminRoot)
  const evidence = resolve(artifactRoot)
  assert.ok(
    admin === join(repository, "backend/.medusa/server/public/admin") ||
      admin.startsWith(`${artifacts}${sep}`),
    "News requires owned compiled Admin artifacts"
  )
  assert.ok(
    evidence.startsWith(`${artifacts}${sep}`),
    "News evidence requires a private artifacts directory"
  )
  const directoryChain = async (target, allowMissing) => {
    const parts = relative(repository, target).split(sep)
    assert.ok(
      parts.length &&
        parts.every(
          (part) => part && part !== "." && part !== ".." && part !== "Default"
        )
    )
    let current = repository
    for (const part of parts) {
      current = join(current, part)
      let stat
      try {
        stat = await lstat(current)
      } catch (error) {
        if (allowMissing && error.code === "ENOENT") continue
        throw error
      }
      assert.ok(
        !stat.isSymbolicLink() && stat.isDirectory(),
        "News directory ancestors must be owned directories"
      )
    }
  }
  await directoryChain(admin, false)
  assert.equal(
    await realpath(admin),
    admin,
    "Compiled Admin path cannot traverse a symlink"
  )
  await directoryChain(evidence, true)
  return { adminRoot: admin, artifactRoot: evidence }
}
const fileHashes = async (root) => {
  const hashes = {}
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      assert.notEqual(
        item.name,
        "Default",
        "Default is outside the compiled News inventory"
      )
      const path = join(directory, item.name)
      assert.ok(
        !item.isSymbolicLink(),
        "Compiled News artifacts cannot be symlinks"
      )
      if (item.isDirectory()) await walk(path)
      else if (item.isFile())
        hashes[relative(root, path)] = digest(await readFile(path))
    }
  }
  await walk(root)
  assert.ok(hashes["index.html"] && Object.keys(hashes).length > 100)
  return hashes
}
const executionSourceHashes = async () => {
  const paths = [
    new URL("./native-news-browser.mjs", import.meta.url),
    new URL("./lib/native-news-loopback-proxy.mjs", import.meta.url),
    new URL("./lib/native-news-browser-process.mjs", import.meta.url),
  ]
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        relative(repositoryRoot, fileURLToPath(path)),
        digest(await readFile(path)),
      ])
    )
  )
}
const settle = (page) =>
  page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.effect?.getComputedTiming().iterations === Infinity ||
            (!animation.pending && animation.playState !== "running")
        ),
    { timeout: 15_000 }
  )
const inspectNativeNewsModal = (page, capturePaint = false) =>
  page.evaluate((paint) => {
    const ensure = (condition, message) => {
      if (!condition) throw new Error(message)
    }
    const visible = (node) => {
      const box = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.display !== "none" &&
        style.visibility === "visible" &&
        style.opacity === "1"
      )
    }
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"],[role="alertdialog"]'),
    ].filter(visible)
    if (!dialogs.length) return null
    ensure(dialogs.length === 1, "News requires exactly one visible modal")
    const dialog = dialogs[0]
    ensure(
      dialog.getAttribute("role") === "dialog" &&
        dialog.getAttribute("aria-modal") === "true" &&
        dialog.getAttribute("data-state") === "open" &&
        dialog.classList.contains("shadow-elevation-modal") &&
        getComputedStyle(dialog).position === "fixed" &&
        !dialog.closest('[aria-hidden="true"],[inert]'),
      "News requires its visible native modal contract"
    )
    const selector = "#" + CSS.escape(dialog.id)
    ensure(
      dialog.id && document.querySelectorAll(selector).length === 1,
      "News requires one exact native dialog identity"
    )
    const labels = (dialog.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
    ensure(labels.length > 0 && labels.length <= 2, "News modal needs a name")
    const name = labels
      .map((id) => {
        const label = document.getElementById(id)
        ensure(
          label &&
            dialog.contains(label) &&
            visible(label) &&
            !label.closest('[aria-hidden="true"],[inert]') &&
            document.querySelectorAll("#" + CSS.escape(id)).length === 1,
          "News modal label must resolve inside its visible dialog"
        )
        return (label.textContent ?? "").replace(/\s+/gu, " ").trim()
      })
      .join(" ")
    ensure(name.length > 0 && name.length <= 512, "News modal name is required")
    const nativeRoots = document.querySelectorAll("#medusa")
    const nativePortalObservation = {
      nativeRootSelector: "#medusa",
      count: nativeRoots.length,
      dialogWithinRoot:
        nativeRoots.length === 1 ? nativeRoots[0].contains(dialog) : null,
      bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
      dialogPointerEvents: getComputedStyle(dialog).pointerEvents,
    }
    ensure(
      nativePortalObservation.count === 1 &&
        nativePortalObservation.dialogWithinRoot === false &&
        nativePortalObservation.bodyPointerEvents === "none" &&
        nativePortalObservation.dialogPointerEvents === "auto",
      "News modal must retain native portal and outside-pointer blocking: " +
        JSON.stringify(nativePortalObservation)
    )
    const children = [...dialog.querySelectorAll("*")]
    ensure(
      children.length <= 2048,
      "News modal DOM observation must be bounded"
    )
    let headingPaint = null
    if (paint) {
      const headings = labels
        .map((id) => document.getElementById(id))
        .filter((node) => node?.tagName === "H2")
      ensure(
        headings.length === 1,
        "Heading observation needs the exact native h2"
      )
      const heading = headings[0]
      const plainText = heading.textContent ?? ""
      ensure(
        plainText.length > 0 && plainText.length <= 512,
        "Heading text must be bounded"
      )
      const rect = (box) => {
        const values = [box.x, box.y, box.width, box.height]
        ensure(values.every(Number.isFinite), "Heading geometry must be finite")
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      const describe = (node) => ({
        tag: node.tagName,
        id: (node.id ?? "").slice(0, 160),
        role: node.getAttribute("role"),
        className: (node.getAttribute("class") ?? "").slice(0, 240),
        withinDialog: dialog.contains(node),
        exactHeading: node === heading,
        headingDescendant: node !== heading && heading.contains(node),
      })
      const stackSummary = (stack) => ({
        fullNodeCount: stack.length,
        truncated: stack.length > 64,
        nodes: stack.slice(0, 64).map(describe),
      })
      const pointObservation = (box) => {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        const insideViewport =
          x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
        const stack = insideViewport ? document.elementsFromPoint(x, y) : []
        ensure(stack.length <= 2048, "Heading DOM paint stack must be bounded")
        return {
          x,
          y,
          insideViewport,
          headingIsTop: insideViewport
            ? Boolean(stack[0] && heading.contains(stack[0]))
            : null,
          stack: stackSummary(stack),
        }
      }
      const rangeObservation = (range) => {
        const boxes = [...range.getClientRects()]
        ensure(boxes.length <= 32, "Heading Range rectangles must be bounded")
        return boxes.map((box) => ({
          ...rect(box),
          centerPaint: pointObservation(box),
        }))
      }
      const ancestors = []
      for (
        let node = heading;
        node && ancestors.length < 12;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node)
        ensure(
          [
            node.scrollLeft,
            node.scrollTop,
            node.clientLeft,
            node.clientTop,
            node.clientWidth,
            node.clientHeight,
          ].every(Number.isFinite),
          "Heading clip geometry must be finite"
        )
        ancestors.push({
          ...describe(node),
          box: rect(node.getBoundingClientRect()),
          clientLeft: node.clientLeft,
          clientTop: node.clientTop,
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          scrollLeft: node.scrollLeft,
          scrollTop: node.scrollTop,
          display: style.display,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          opacity: style.opacity,
          position: style.position,
          transform: style.transform,
          zIndex: style.zIndex,
        })
        if (node === dialog) break
      }
      ensure(
        ancestors.at(-1)?.id === dialog.id,
        "Heading ancestors must reach the exact dialog"
      )
      const range = document.createRange()
      range.selectNodeContents(heading)
      const textRects = rangeObservation(range)
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
      const graphemes = []
      const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
      let textNodes = 0
      let totalTextLength = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        textNodes++
        totalTextLength += node.data.length
        ensure(
          textNodes <= 8 && totalTextLength <= 512,
          "Heading text-node traversal must be bounded"
        )
        for (const segment of segmenter.segment(node.data)) {
          if (!segment.segment.trim()) continue
          ensure(
            graphemes.length < 512,
            "Heading grapheme observation must be bounded"
          )
          const glyphRange = document.createRange()
          glyphRange.setStart(node, segment.index)
          glyphRange.setEnd(node, segment.index + segment.segment.length)
          graphemes.push({
            textNodeIndex: textNodes - 1,
            utf16Offset: segment.index,
            utf16Length: segment.segment.length,
            rects: rangeObservation(glyphRange),
          })
        }
      }
      const axeTextStacks = {
        apiPresent:
          typeof window.axe?.commons?.dom?.getTextElementStack === "function",
        available: false,
        status: "not-invoked-lazy-grid-bounds-unproved",
        noLazyInitialization: true,
      }
      headingPaint = {
        exactTargetId: heading.id,
        targetFromNativeAriaLabelledby: true,
        plainTextLength: plainText.length,
        textNodeCount: textNodes,
        ancestors,
        textRects,
        graphemes,
        axeTextStacks,
        manualContrastPass: false,
        noPaintOrFocusMutation: true,
      }
    }
    let publicationPaint = null
    if (paint) {
      const sections = [
        ...dialog.querySelectorAll('section[aria-label="Saved News request"]'),
      ]
      ensure(sections.length <= 1, "News recovery ownership must be unique")
      if (sections.length) {
        const terms = [...sections[0].querySelectorAll("dt")].filter(
          (node) => node.textContent === "Publication"
        )
        const value = terms[0]?.nextElementSibling
        ensure(
          terms.length === 1 && value?.tagName === "DD",
          "News recovery must retain its Publication value"
        )
        const rect = (box) => ({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        })
        const describe = (node) => ({
          tag: node.tagName,
          id: node.id,
          role: node.getAttribute("role"),
          className: (node.getAttribute("class") ?? "").slice(0, 240),
          withinDialog: dialog.contains(node),
          publication: node === value,
        })
        const ancestors = []
        for (
          let node = value;
          node && ancestors.length < 12;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node)
          ancestors.push({
            ...describe(node),
            box: rect(node.getBoundingClientRect()),
            color: style.color,
            backgroundColor: style.backgroundColor,
            transform: style.transform,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            opacity: style.opacity,
            position: style.position,
            zIndex: style.zIndex,
          })
          if (node === dialog) break
        }
        ensure(
          ancestors.at(-1)?.id === dialog.id,
          "Publication ancestors must reach the exact News dialog"
        )
        const range = document.createRange()
        range.selectNodeContents(value)
        const textRects = [...range.getClientRects()]
        ensure(
          textRects.length > 0 && textRects.length <= 8,
          "Publication text rectangle observation must be bounded"
        )
        const fullyVisible = textRects.every(
          (box) =>
            box.width > 0 &&
            box.height > 0 &&
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight &&
            ancestors.every(
              (ancestor) =>
                (ancestor.overflowX === "visible" ||
                  (box.left >= ancestor.box.x - 0.5 &&
                    box.right <= ancestor.box.x + ancestor.box.width + 0.5)) &&
                (ancestor.overflowY === "visible" ||
                  (box.top >= ancestor.box.y - 0.5 &&
                    box.bottom <= ancestor.box.y + ancestor.box.height + 0.5))
            )
        )
        publicationPaint = {
          includedInExactDialog: dialog.contains(value),
          fullyVisible,
          ancestors,
          textRects: textRects.map((box) => ({
            ...rect(box),
            paintStack: document
              .elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              .slice(0, 12)
              .map(describe),
          })),
          manualContrastPass: false,
        }
      }
    }
    return {
      selector,
      name,
      nativePortalObservation,
      nativePortalAndPointerBlock: true,
      focusInside: dialog.contains(document.activeElement),
      focusKey: children.indexOf(document.activeElement),
      publicationPaint,
      headingPaint,
    }
  }, capturePaint)
const proveNativeNewsModalKeyboard = async (page, proxy, modal) => {
  const before = commandHash(proxy.commandSnapshot())
  const counts = () => ({
    puts: proxy.receipts.filter((entry) => entry.method === "PUT").length,
    mutations: proxy.receipts.filter((entry) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(entry.method)
    ).length,
  })
  const beforeCounts = counts()
  const started = Date.now()
  let keys = 0
  const state = async () => {
    const current = await inspectNativeNewsModal(page)
    assert.equal(current?.selector, modal.selector, "Native News modal changed")
    assert.equal(current.name, modal.name, "Native News modal name changed")
    assert.equal(
      current.focusInside,
      true,
      "Focus escaped the native News modal"
    )
    assert.ok(
      Date.now() - started <= 5000,
      "News modal keyboard proof timed out"
    )
    return current.focusKey
  }
  const tab = async () => {
    assert.ok(keys < 62, "News modal keyboard proof exceeded its 64-key bound")
    keys += 1
    await page.keyboard.press("Tab")
    return state()
  }
  let anchor = await state()
  if (anchor < 0) anchor = await tab()
  assert.ok(anchor >= 0, "Native News Tab must reach a dialog control")
  const cycle = async () => {
    const visited = []
    for (;;) {
      const key = await tab()
      assert.ok(key >= 0, "Native News Tab must stay on a dialog control")
      if (key === anchor) return [...visited, anchor]
      assert.ok(!visited.includes(key), "Native News Tab loop lost its anchor")
      visited.push(key)
    }
  }
  const forward = await cycle()
  assert.ok(keys < 62, "News reverse Tab proof needs its remaining key budget")
  keys += 1
  await page.keyboard.down("Shift")
  let reverse
  try {
    reverse = await cycle()
  } finally {
    keys += 1
    await page.keyboard.up("Shift")
  }
  assert.ok(keys <= 64 && Date.now() - started <= 5000)
  assert.deepEqual(
    reverse,
    [...forward.slice(0, -1)].reverse().concat(anchor),
    "Native News reverse Tab must traverse the same contained controls"
  )
  assert.equal(
    commandHash(proxy.commandSnapshot()),
    before,
    "Tab changed the exact saved News command"
  )
  assert.deepEqual(counts(), beforeCounts, "Tab sent a News mutation")
  return {
    keys,
    elapsedMs: Date.now() - started,
    forward,
    reverse,
    exactCommandSha256: before,
    exactCommandUnchanged: true,
    putAndMutationCountsUnchanged: true,
  }
}
const nativeNewsDocumentContexts = (page, raw, modal) => {
  const findings = [...raw.violations, ...raw.incomplete]
  assert.ok(
    findings.reduce((count, finding) => count + finding.nodes.length, 0) <= 64
  )
  return page.evaluate(
    ({ findings, selector }) => {
      const dialog = document.querySelector(selector)
      const root = document.getElementById("medusa")
      if (!dialog || !root) throw new Error("Native News context changed")
      return findings.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ target, all, any, none }) => {
          const element =
            target.length === 1 && typeof target[0] === "string"
              ? document.querySelectorAll(target[0])
              : []
          const node = element.length === 1 ? element[0] : null
          const outside = Boolean(
            node && !dialog.contains(node) && !node.contains(dialog)
          )
          const nativeHidden = Boolean(
            outside &&
              node.matches('[data-aria-hidden="true"][aria-hidden="true"]')
          )
          const hiddenApp = Boolean(nativeHidden && root.contains(node))
          const focusGuard = Boolean(
            nativeHidden &&
              node.parentElement === document.body &&
              !root.contains(node) &&
              node.matches('span[data-radix-focus-guard][tabindex="0"]') &&
              node.children.length === 0
          )
          return {
            target,
            selectorResolvedUniquely: Boolean(node),
            withinDialog: Boolean(node && dialog.contains(node)),
            exactNativeHiddenAppRoot: hiddenApp,
            exactNativeFocusGuard: focusGuard,
            contextualOutsideOnly:
              id === "aria-hidden-focus" &&
              (hiddenApp || focusGuard) &&
              any.length === 0 &&
              none.length === 0 &&
              all.length === 1 &&
              all[0].id === "focusable-modal-open",
          }
        }),
      }))
    },
    { findings, selector: modal.selector }
  )
}
const click = async (page, label) => {
  const handles = await page.$$("button,a")
  try {
    for (const handle of handles) {
      const matches = await handle.evaluate((node, expected) => {
        const box = node.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.height > 0 &&
          !node.disabled &&
          (node.textContent ?? "").replace(/\s+/g, " ").trim() === expected
        )
      }, label)
      if (matches) {
        await handle.click()
        return
      }
    }
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
  throw new Error(`Visible native News control missing: ${label}`)
}
const recoveryControlState = (label, readyOnly = false) => {
  const matches = [...document.querySelectorAll("button,a")].filter(
    (node) => (node.textContent ?? "").replace(/\s+/gu, " ").trim() === label
  )
  const controls = matches.slice(0, 8).map((node) => {
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      tag: node.tagName,
      connected: node.isConnected,
      visible:
        box.width > 0 &&
        box.height > 0 &&
        style.display !== "none" &&
        style.visibility === "visible" &&
        style.opacity === "1" &&
        !node.closest('[aria-hidden="true"],[inert]'),
      enabled: !node.disabled && node.getAttribute("aria-disabled") !== "true",
      width: box.width,
      height: box.height,
    }
  })
  const ready =
    matches.length === 1 &&
    controls[0].tag === "BUTTON" &&
    controls[0].connected &&
    controls[0].visible &&
    controls[0].enabled
  const state = { count: matches.length, ready, controls }
  return readyOnly && !ready ? false : state
}
const recoverSavedRequest = async (page) => {
  const label = "Recover saved News request"
  let lookup = null
  try {
    const ready = await page.waitForFunction(
      recoveryControlState,
      { timeout: 15_000 },
      label,
      true
    )
    try {
      lookup = await ready.jsonValue()
    } finally {
      await ready.dispose()
    }
    await click(page, label)
    return lookup
  } catch {
    const current = await page
      .evaluate(recoveryControlState, label)
      .catch(() => ({ unavailable: true }))
    throw new Error(
      "Native saved News recovery control lookup failed: " +
        JSON.stringify({ lookup, current })
    )
  }
}
const replaceNewsTitle = async (page, value) => {
  const control = await page.$('[role="dialog"] input#news-title')
  assert.ok(control)
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
    const exact = await control.evaluate(
      (node, expected) =>
        new Promise((resolve) => {
          const started = performance.now()
          let frames = 0
          let frame = null
          let finished = false
          const finish = (result) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            if (frame !== null) cancelAnimationFrame(frame)
            resolve(result)
          }
          const timer = setTimeout(() => finish(false), 2000)
          const verify = () => {
            if (finished) return
            frames += 1
            if (
              node.isConnected &&
              document.activeElement === node &&
              node.value === expected
            )
              return finish(true)
            if (frames >= 128 || performance.now() - started >= 2000)
              return finish(false)
            frame = requestAnimationFrame(verify)
          }
          verify()
        }),
      value
    )
    assert.equal(exact, true, "Native News title must match its keyboard input")
  } finally {
    await control.dispose()
  }
}
const keyboardActivate = async (page, label) => {
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press("Tab")
    const focused = await page.evaluate(() => {
      const active = document.activeElement
      const box = active?.getBoundingClientRect()
      const style = active ? getComputedStyle(active) : null
      return {
        tag: active?.tagName,
        text: (active?.textContent ?? "").replace(/\s+/g, " ").trim(),
        disabled: active?.disabled ?? false,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        outlineStyle: style?.outlineStyle,
        outlineWidth: style?.outlineWidth,
        boxShadow: style?.boxShadow,
      }
    })
    if (
      focused.tag === "BUTTON" &&
      focused.text === label &&
      !focused.disabled
    ) {
      assert.ok(
        focused.width >= 24 && focused.height >= 24,
        "Keyboard action target is too small"
      )
      assert.ok(
        focused.boxShadow !== "none" ||
          (focused.outlineStyle !== "none" && focused.outlineWidth !== "0px"),
        "Keyboard action has no visible focus indicator"
      )
      await page.keyboard.press("Enter")
      return focused
    }
  }
  throw new Error(`Native Tab order did not reach ${label}`)
}
const openEditor = async (page, entry) => {
  await page.waitForFunction(
    (title) =>
      [
        ...document.querySelectorAll(
          "main tr,main ul[aria-label='News posts']>li"
        ),
      ].some(
        (row) =>
          row.textContent?.includes(title) &&
          [...row.querySelectorAll("button")].some(
            (button) =>
              button.textContent?.trim() === "Edit" && !button.disabled
          )
      ),
    { timeout: 15_000 },
    entry.title
  )
  const handle = await page.evaluateHandle((title) => {
    const rows = [
      ...document.querySelectorAll(
        "main tr,main ul[aria-label='News posts']>li"
      ),
    ]
    return rows
      .filter(
        (row) =>
          row.getBoundingClientRect().width > 0 &&
          row.textContent?.includes(title)
      )
      .flatMap((row) => [...row.querySelectorAll("button")])
      .find(
        (button) => button.textContent?.trim() === "Edit" && !button.disabled
      )
  }, entry.title)
  try {
    assert.ok(handle.asElement())
    await handle.asElement().click()
  } finally {
    await handle.dispose()
  }
  await page.waitForSelector('[role="dialog"] #news-title', { timeout: 15_000 })
  const idBindings = await page.evaluate(() => {
    const heading = document.querySelector("#news-workspace-title")
    const title = document.querySelector('[role="dialog"] input#news-title')
    const titleLabel = document.querySelector(
      '[role="dialog"] label[for="news-title"]'
    )
    return {
      workspaceHeadingCount: document.querySelectorAll("#news-workspace-title")
        .length,
      editorTitleCount: document.querySelectorAll("#news-title").length,
      workspaceHeadingIsHeading: !!heading?.closest("h1"),
      workspaceHeadingTag: heading?.tagName,
      editorTitleIsInput: title instanceof HTMLInputElement,
      editorTitleType: title?.getAttribute("type"),
      editorTitleLabelIsBound: titleLabel?.control === title,
    }
  })
  assert.equal(idBindings.workspaceHeadingCount, 1)
  assert.equal(idBindings.editorTitleCount, 1)
  assert.equal(idBindings.workspaceHeadingIsHeading, true)
  assert.equal(idBindings.workspaceHeadingTag, "SPAN")
  assert.equal(idBindings.editorTitleIsInput, true)
  assert.equal(idBindings.editorTitleType, "text")
  assert.equal(idBindings.editorTitleLabelIsBound, true)
  assert.equal(
    await page.$eval('[role="dialog"] input#news-title', (node) => node.value),
    entry.title
  )
  await settle(page)
  return idBindings
}
const waitClosed = (page) =>
  page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    timeout: 15_000,
  })
const waitSaved = (page, title) =>
  page.waitForFunction(
    (expected) =>
      document
        .querySelector('section[aria-label="Saved News request"]')
        ?.textContent?.includes(expected),
    { timeout: 15_000 },
    title
  )
const visibleSavedId = (page) =>
  page.$eval('section[aria-label="Saved News request"]', (section) => {
    const label = [...section.querySelectorAll("dt")].find(
      (node) => node.textContent === "Saved request ID"
    )
    return label?.nextElementSibling?.textContent
  })

// Called only by the guarded rr_disposable_news runner. No app bootstrap,
// artifact build, staging login, credential export or provider call occurs here.
export const runNativeNewsBrowserAcceptance = async ({
  fixture,
  adminRoot,
  artifactRoot,
  mode,
}) => {
  ;({ adminRoot, artifactRoot } = await validateNewsBrowserDirectories(
    adminRoot,
    artifactRoot
  ))
  assert.ok(
    ["desktop-light", "desktop-dark", "phone-light", "phone-dark"].includes(
      mode
    )
  )
  const selected =
    process.env.ADMIN_ACCEPTANCE_BROWSER?.trim() ||
    ["/usr/bin/helium", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(
      existsSync
    )
  assert.ok(selected, "A native Chromium executable is required")
  const executablePath = await realpath(selected)
  assert.ok((await lstat(executablePath)).isFile())
  const compiled = await fileHashes(adminRoot)
  const sourceBefore = await executionSourceHashes()
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
  await validateNewsBrowserDirectories(adminRoot, artifactRoot)
  const output = resolve(artifactRoot, mode)
  assert.ok(output.startsWith(`${resolve(artifactRoot)}/`))
  await mkdir(output, { mode: 0o700 })
  assert.equal(
    (await readdir(output)).length,
    0,
    "News evidence output must be fresh"
  )
  const date = new Date(Date.now() + 86_400_000)
  date.setUTCSeconds(0, 0)
  const create = (name, extra = {}) =>
    fixture.create({
      title: `Owned ${name} ${mode}`,
      content: "<p>Owned native News story</p>",
      coverUrl: null,
      coverAltText: null,
      excerpt: null,
      tags: [],
      status: "draft",
      publishedAt: null,
      ...extra,
    })
  const posts = {
    publish: await create("Publish"),
    reload: await create("Reload"),
    switch: await create("Actor switch"),
    staleDraft: await create("Stale draft"),
    staleSchedule: await create("Stale schedule", {
      status: "scheduled",
      publishedAt: date.toISOString(),
    }),
  }
  const upstream = new URL(fixture.origin)
  upstream.hostname = "127.0.0.1"
  // Read the initialized native middleware's actual headers; this immutable
  // fixture bundle uses the same origin and must exercise its real CSP.
  const nativeRead = await fixture.request(
    "GET",
    `/admin/news/${posts.publish.id}`
  )
  assert.equal(nativeRead.status, 200)
  assert.equal(nativeRead.data?.entry?.id, posts.publish.id)
  const securityHeaders = readNativeNewsSecurityHeaders(nativeRead.headers)
  const proxy = await startNativeNewsLoopbackProxy({
    upstreamOrigin: upstream.origin,
    staticRoot: adminRoot,
    staticHashes: compiled,
    actors: Object.values(fixture.actors),
    ownedNewsIds: Object.values(posts).map((post) => post.id),
    staticResponseHeaders: securityHeaders,
  })
  let browser, context, page, browserProcesses
  let browserProcessProof = null
  let finalSourceProof = null
  let failure = null
  const cases = [],
    deniedRemote = [],
    pageErrors = [],
    cleanup = []
  const checkpoint = async (name, evidence = {}) => {
    await browserProcesses.capture()
    await settle(page)
    const stem = `${String(cases.length + 1).padStart(2, "0")}-${name}`
    const modal = await inspectNativeNewsModal(page)
    const modalKeyboard = modal
      ? await proveNativeNewsModalKeyboard(page, proxy, modal)
      : null
    const publicationBeforeAxe = modal
      ? await inspectNativeNewsModal(page, true)
      : null
    // Retain all document findings. Only native outside aria-hidden-focus
    // uncertainty may be contextualized by the actual contained Tab proof.
    const documentRaw = await new AxePuppeteer(page).analyze()
    const documentAxePath = join(output, stem + ".axe.json")
    await writeFile(
      documentAxePath,
      JSON.stringify(documentRaw, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      }
    )
    const contexts = modal
      ? await nativeNewsDocumentContexts(page, documentRaw, modal)
      : []
    const raw = modal
      ? await new AxePuppeteer(page).include(modal.selector).analyze()
      : documentRaw
    const axePath = modal
      ? join(output, stem + ".dialog.axe.json")
      : documentAxePath
    if (modal)
      await writeFile(axePath, JSON.stringify(raw, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      })
    const publicationAfterAxe = modal
      ? await inspectNativeNewsModal(page, true)
      : null
    const knownOutsideIncompleteOnly = modal
      ? documentRaw.incomplete.every(
          (finding, index) =>
            finding.nodes.length > 0 &&
            contexts[documentRaw.violations.length + index].nodes.every(
              (node) => node.contextualOutsideOnly
            )
        )
      : documentRaw.incomplete.length === 0
    const contextPath = modal
      ? join(output, stem + ".document-context.json")
      : null
    if (modal)
      await writeFile(
        contextPath,
        JSON.stringify(
          {
            modal,
            modalKeyboard,
            contexts,
            knownOutsideIncompleteOnly,
            publicationBeforeAxe,
            publicationAfterAxe,
            manualContrastPass: false,
          },
          null,
          2
        ) + "\n",
        { flag: "wx", mode: 0o600 }
      )
    const screenshot = join(output, `${stem}.png`)
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      optimizeForSpeed: true,
    })
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      brokenImages: [...document.images].filter(
        (image) => image.complete && image.naturalWidth === 0
      ).length,
      focus: {
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent?.slice(0, 150),
      },
    }))
    cases.push({
      name,
      axe: {
        path: axePath,
        sha256: digest(await readFile(axePath)),
        scope: modal ? "verified-native-dialog" : "document",
        violations: raw.violations.map((item) => ({
          id: item.id,
          impact: item.impact,
          nodes: item.nodes.length,
        })),
        incomplete: raw.incomplete.map((item) => ({
          id: item.id,
          nodes: item.nodes.length,
        })),
      },
      documentAxe: {
        path: documentAxePath,
        sha256: digest(await readFile(documentAxePath)),
        violations: documentRaw.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.length,
        })),
        incomplete: documentRaw.incomplete.map((item) => ({
          id: item.id,
          nodes: item.nodes.length,
        })),
      },
      modalContext: contextPath
        ? {
            path: contextPath,
            sha256: digest(await readFile(contextPath)),
            knownOutsideIncompleteOnly,
            keyboard: modalKeyboard,
          }
        : null,
      screenshot,
      screenshotSha256: digest(await readFile(screenshot)),
      layout,
      ...evidence,
    })
    assert.equal(
      documentRaw.violations.length,
      0,
      "All-rule document News Axe failed at " + name
    )
    assert.equal(
      knownOutsideIncompleteOnly,
      true,
      "News document Axe has unresolved findings at " + name
    )
    if (modal) {
      assert.equal(publicationAfterAxe.selector, modal.selector)
      assert.equal(publicationAfterAxe.name, modal.name)
      assert.equal(publicationAfterAxe.focusInside, true)
      assert.equal(
        commandHash(proxy.commandSnapshot()),
        modalKeyboard.exactCommandSha256,
        "News accessibility probes changed the exact saved command"
      )
      if (proxy.commandSnapshot()?.body)
        assert.ok(publicationBeforeAxe.publicationPaint)
      assert.equal(
        Boolean(publicationBeforeAxe.publicationPaint),
        Boolean(publicationAfterAxe.publicationPaint)
      )
      for (const observation of [publicationBeforeAxe, publicationAfterAxe]) {
        if (observation.publicationPaint) {
          assert.equal(observation.publicationPaint.includedInExactDialog, true)
          assert.equal(
            observation.publicationPaint.fullyVisible,
            true,
            "News Publication text must remain visible to the all-rule scan"
          )
        }
      }
    }
    assert.equal(
      raw.violations.length,
      0,
      `All-rule News Axe failed at ${name}`
    )
    assert.equal(
      raw.incomplete.length,
      0,
      `News Axe requires manual review at ${name}`
    )
    assert.equal(layout.overflow, false, `News viewport overflow at ${name}`)
    assert.equal(layout.brokenImages, 0, `News image failed at ${name}`)
  }
  const signIn = async (actor, keepContext = false) => {
    if (!keepContext) {
      await context?.close()
      context = await browser.createBrowserContext()
      page = await context.newPage()
      await page.setViewport(
        mode.startsWith("phone")
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 }
      )
      await page.evaluateOnNewDocument(
        (theme) => localStorage.setItem("medusa_admin_theme", theme),
        mode.endsWith("dark") ? "dark" : "light"
      )
      await page.setRequestInterception(true)
      page.on("request", (request) => {
        const target = new URL(request.url())
        if (
          target.origin === proxy.origin ||
          ["data:", "blob:"].includes(target.protocol)
        )
          void request.continue()
        else {
          deniedRemote.push({
            method: request.method(),
            origin: target.origin,
            path: target.pathname,
          })
          void request.abort("blockedbyclient")
        }
      })
      page.on("pageerror", (error) =>
        pageErrors.push({ name: error.name, message: error.message })
      )
    } else await page.evaluate(() => window.__sdk.auth.logout())
    // The actual native protected route preserves its safe return destination.
    await page.goto(`${proxy.origin}/app/content/news`, {
      waitUntil: "networkidle0",
    })
    await page.waitForSelector('input[name="email"]', { timeout: 15_000 })
    await page.type('input[name="email"]', actor.email)
    await page.type('input[type="password"]', actor.password)
    await click(page, "Continue with Email")
    await page.waitForFunction(
      () => location.pathname === "/app/content/news",
      { timeout: 15_000 }
    )
    const me = await page.evaluate(() => window.__sdk.admin.user.me())
    assert.equal(me.user.id, actor.id, "Native browser session actor differs")
    await page.waitForFunction(
      () => document.querySelector("main")?.textContent?.includes("Owned"),
      { timeout: 15_000 }
    )
  }
  const commandProof = async (post, expectedStatus = "succeeded") => {
    const command = proxy.commandSnapshot()
    assert.ok(command?.body && command.idempotencyKey)
    const rows = await fixture.operations(command.idempotencyKey)
    assert.equal(rows.length, expectedStatus === "succeeded" ? 1 : 0)
    if (rows.length) {
      const row = rows[0]
      const { expectedActorId, ...payload } = command.body
      assert.equal(row.actor_id, expectedActorId)
      assert.equal(row.aggregate_id, post.id)
      assert.equal(row.command, "news.entry.update")
      assert.equal(row.expected_version, command.body.expectedVersion)
      assert.equal(row.status, "succeeded")
      assert.equal(
        row.request_sha256,
        commandHash({
          aggregateId: post.id,
          command: row.command,
          expectedVersion: row.expected_version,
          payload,
        })
      )
      assert.equal(row.result.entry.version, row.expected_version + 1)
    }
    return {
      command,
      operation: rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null,
    }
  }
  const arm = (post, input, dropSuccesses) =>
    proxy.armNewsUpdate({
      entryId: post.id,
      expectedActorId: fixture.actors.first.id,
      expectedVersion: post.version,
      bodyWithoutCommandFields: input,
      dropSuccesses,
    })
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--disable-dev-shm-usage"],
    })
    browserProcesses = await trackNativeNewsBrowserProcess(browser.process())
    await browserProcesses.capture()
    await signIn(fixture.actors.first)
    await checkpoint("native-news-session-and-current-list", {
      actorId: fixture.actors.first.id,
      nativePosts: Object.values(posts).map((post) => post.id),
    })

    const publishEditorIdBindings = await openEditor(page, posts.publish)
    arm(posts.publish, inputFor(posts.publish), 1)
    const publishFocus = await keyboardActivate(page, "Publish changes")
    await waitClosed(page)
    const published = await fixture.entry(posts.publish.id)
    const publishProof = await commandProof(posts.publish)
    assert.equal(published.version, 2)
    assert.equal(published.status, "published")
    assert.ok(
      published.publishedAt &&
        Number.isFinite(Date.parse(published.publishedAt))
    )
    assert.equal(publishProof.command.dropped, 1)
    assert.equal(publishProof.command.putCount, 2)
    assert.equal(publishProof.command.body.publishedAt, null)
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("remorseless-records.news-update.v1")
      ),
      null
    )
    await page.waitForSelector('[aria-label="News confirmation"]', {
      timeout: 15_000,
    })
    const confirmation = await page.evaluate(() => {
      const status = document.querySelector('[aria-label="News confirmation"]')
      const button = status?.querySelector(
        'button[aria-label="Dismiss News confirmation"]'
      )
      const navigation = document.querySelector(
        'nav[aria-label="Content workspaces"]'
      )
      const bounds = (element) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }
      }
      return {
        role: status?.getAttribute("role"),
        live: status?.getAttribute("aria-live"),
        position: status && getComputedStyle(status).position,
        text: status?.textContent,
        statusBounds: bounds(status),
        buttonBounds: bounds(button),
        navigationBounds: bounds(navigation),
      }
    })
    assert.equal(confirmation.role, "status")
    assert.equal(confirmation.live, "polite")
    assert.ok(!["absolute", "fixed"].includes(confirmation.position))
    assert.match(confirmation.text, /News post published/u)
    assert.match(confirmation.text, /current list may reflect later edits/u)
    assert.ok(
      confirmation.buttonBounds?.width >= 24 &&
        confirmation.buttonBounds.height >= 24
    )
    assert.ok(confirmation.navigationBounds && confirmation.statusBounds)
    assert.ok(
      confirmation.statusBounds.top >= confirmation.navigationBounds.bottom,
      "News confirmation must follow its workspace navigation in page flow"
    )
    await checkpoint("publish-lost-reply-exact-native-replay", {
      ...publishProof,
      current: published,
      keyboardFocus: publishFocus,
      confirmation,
      editorIdBindings: publishEditorIdBindings,
    })
    await keyboardActivate(page, "Dismiss")
    await page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="News confirmation"]') &&
        document.activeElement?.id === "news-search",
      { timeout: 15_000 }
    )
    assert.equal(proxy.commandSnapshot().putCount, 2)
    await checkpoint("dismiss-success-feedback-without-resending-command", {
      ...publishProof,
      feedbackDismissed: true,
      focusRestoredToNewsSearch: true,
    })
    proxy.finishCommand()

    await openEditor(page, posts.reload)
    arm(posts.reload, inputFor(posts.reload), 2)
    await keyboardActivate(page, "Publish changes")
    await waitSaved(page, "News save unconfirmed")
    const uncertain = await commandProof(posts.reload)
    assert.equal(uncertain.command.putCount, 2)
    assert.equal(uncertain.command.dropped, 2)
    assert.equal(await visibleSavedId(page), uncertain.command.idempotencyKey)
    await checkpoint(
      "two-lost-replies-retain-visible-original-request",
      uncertain
    )
    await page.reload({ waitUntil: "networkidle0" })
    const reloadRecoveryLookup = await recoverSavedRequest(page)
    await waitSaved(page, "News save unconfirmed")
    assert.equal(await visibleSavedId(page), uncertain.command.idempotencyKey)
    assert.equal(proxy.commandSnapshot().putCount, 2, "Reload must not resend")
    const original = await fixture.entry(posts.reload.id)
    const laterBody = fixture.body(
      original,
      inputFor(original, "published", `Later writer ${mode}`),
      fixture.actors.second
    )
    assert.equal(
      (
        await fixture.request(
          "PUT",
          `/admin/news/${posts.reload.id}`,
          laterBody,
          fixture.actors.second
        )
      ).status,
      200
    )
    const later = await fixture.entry(posts.reload.id)
    assert.equal(later.version, 3)
    await checkpoint("real-reload-keeps-original-version-and-uuid", {
      ...uncertain,
      laterCurrent: later,
      recoveryLookup: reloadRecoveryLookup,
    })
    await keyboardActivate(page, "Retry saved News request")
    await waitClosed(page)
    const recovered = await commandProof(posts.reload)
    assert.equal(recovered.command.putCount, 3)
    assert.deepEqual(recovered.operation, uncertain.operation)
    assert.deepEqual(await fixture.entry(posts.reload.id), later)
    assert.equal(recovered.operation.result.entry.version, 2)
    assert.ok(
      text(await page.$eval("main", (node) => node.textContent)).includes(
        later.title
      ),
      "Historical acknowledgement replaced current list"
    )
    await checkpoint(
      "historical-command-confirmed-current-later-writer-retained",
      { ...recovered, current: later }
    )
    proxy.finishCommand()

    await openEditor(page, posts.switch)
    arm(posts.switch, inputFor(posts.switch), 2)
    await keyboardActivate(page, "Publish changes")
    await waitSaved(page, "News save unconfirmed")
    const switched = await commandProof(posts.switch)
    const actorReadsBeforeSwitch = proxy.receipts.filter(
      (row) => row.method === "GET" && row.path === "/admin/users/me"
    ).length
    await signIn(fixture.actors.second, true)
    await page.waitForFunction(
      () => document.body.textContent?.includes("original administrator"),
      { timeout: 15_000 }
    )
    assert.equal(proxy.commandSnapshot().putCount, 2)
    assert.ok(
      proxy.receipts.filter(
        (row) => row.method === "GET" && row.path === "/admin/users/me"
      ).length > actorReadsBeforeSwitch,
      "Session switch must read the native actor freshly"
    )
    const switchedControls = await page.evaluate(() => ({
      warning: [...document.querySelectorAll('main [role="alert"]')].some(
        (node) => node.textContent?.includes("original administrator")
      ),
      actionable: [...document.querySelectorAll("main button")]
        .filter(
          (node) =>
            !node.disabled &&
            [
              "Edit",
              "Recover saved News request",
              "Retry saved News request",
            ].includes(node.textContent?.trim())
        )
        .map((node) => node.textContent?.trim()),
    }))
    assert.equal(switchedControls.warning, true)
    assert.deepEqual(switchedControls.actionable, [])
    const retained = await page.evaluate(() => {
      const raw = localStorage.getItem("remorseless-records.news-update.v1")
      if (!raw) return null
      const record = JSON.parse(raw)
      return {
        uuid: record.body.idempotencyKey,
        version: record.body.expectedVersion,
        actorId: record.body.expectedActorId,
        status: record.status,
      }
    })
    assert.deepEqual(retained, {
      uuid: switched.command.idempotencyKey,
      version: 1,
      actorId: fixture.actors.first.id,
      status: "uncertain",
    })
    await checkpoint("actual-session-switch-keeps-request-and-sends-no-put", {
      retained,
      originalOperation: switched.operation,
      currentActorId: fixture.actors.second.id,
    })
    await signIn(fixture.actors.first, true)
    const originalActorRecoveryLookup = await recoverSavedRequest(page)
    await waitSaved(page, "News save unconfirmed")
    assert.equal(await visibleSavedId(page), switched.command.idempotencyKey)
    await keyboardActivate(page, "Retry saved News request")
    await waitClosed(page)
    const originalActorReply = await commandProof(posts.switch)
    assert.deepEqual(originalActorReply.operation, switched.operation)
    await checkpoint("original-native-session-recovers-identical-command", {
      ...originalActorReply,
      recoveryLookup: originalActorRecoveryLookup,
    })
    proxy.finishCommand()

    for (const [post, status] of [
      [posts.staleDraft, "draft"],
      [posts.staleSchedule, "scheduled"],
    ]) {
      await openEditor(page, post)
      const title = `Matching other writer ${status} ${mode}`
      await replaceNewsTitle(page, title)
      const input = inputFor(post, status, title)
      const other = fixture.body(post, input, fixture.actors.second)
      assert.equal(
        (
          await fixture.request(
            "PUT",
            `/admin/news/${post.id}`,
            other,
            fixture.actors.second
          )
        ).status,
        200
      )
      const current = await fixture.entry(post.id)
      arm(post, input, 0)
      await keyboardActivate(
        page,
        status === "draft" ? "Save draft" : "Schedule"
      )
      await waitSaved(page, "News request rejected")
      const rejected = await commandProof(post, "rejected")
      assert.equal(rejected.command.putCount, 1)
      assert.deepEqual(rejected.command.statuses, [409])
      assert.equal(rejected.command.attempts[0].dropped, false)
      assert.deepEqual(await fixture.entry(post.id), current)
      assert.equal(await visibleSavedId(page), rejected.command.idempotencyKey)
      await checkpoint(`same-current-${status}-is-not-command-success`, {
        ...rejected,
        current,
      })
      await keyboardActivate(page, "Clear rejected request")
      await waitClosed(page)
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("remorseless-records.news-update.v1")
        ),
        null
      )
      await checkpoint(`clear-definitively-rejected-${status}-without-retry`, {
        ...rejected,
        current,
      })
      proxy.finishCommand()
    }
    assert.equal(deniedRemote.length, 0)
    assert.equal(pageErrors.length, 0)
    assert.equal(proxy.unexpectedRequests.length, 0)
    assert.equal(
      proxy.receipts.filter((row) => row.kind === "denied").length,
      0
    )
    assert.deepEqual(
      await fileHashes(adminRoot),
      compiled,
      "Compiled News bundle changed"
    )
  } catch (error) {
    failure = { name: error.name, message: error.message }
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: join(output, "failed-current-state.png"),
          fullPage: true,
          optimizeForSpeed: true,
        })
        .catch(() => {})
    throw error
  } finally {
    const attemptCleanup = async (name, action) => {
      let timer
      try {
        const operation = Promise.resolve().then(action)
        await Promise.race([
          operation,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Owned ${name} cleanup exceeded its deadline`)
                ),
              10_000
            )
          }),
        ])
        cleanup.push({ name, closed: true })
      } catch (error) {
        cleanup.push({
          name,
          closed: false,
          error: { name: error.name, message: error.message },
        })
      } finally {
        clearTimeout(timer)
      }
    }
    await attemptCleanup("native-session", async () => {
      if (page && !page.isClosed())
        await page.evaluate(() => window.__sdk?.auth.logout())
    })
    await attemptCleanup("browser-context", async () => {
      await context?.close()
    })
    await attemptCleanup("browser", async () => {
      try {
        if (browserProcesses) await browserProcesses.capture()
      } finally {
        await browser?.close()
      }
    })
    await attemptCleanup("owned-browser-process-reaping", async () => {
      assert.ok(browserProcesses, "Browser process identity was not recorded")
      browserProcessProof = await browserProcesses.verifyNaturalClosure()
    })
    await attemptCleanup("owned-loopback-proxy", () => proxy.close())
    await attemptCleanup(
      "compiled-and-execution-source-stability",
      async () => {
        const compiledAfter = await fileHashes(adminRoot)
        const sourceAfter = await executionSourceHashes()
        finalSourceProof = {
          compiledBefore: compiled,
          compiledAfter,
          sourceBefore,
          sourceAfter,
        }
        assert.deepEqual(
          compiledAfter,
          compiled,
          "Compiled News bundle changed"
        )
        assert.deepEqual(
          sourceAfter,
          sourceBefore,
          "News browser execution source changed"
        )
      }
    )
    const incompleteCleanup = cleanup.some((row) => !row.closed)
    const transport = proxy.snapshot()
    const lateFailures = {
      remoteRequests: deniedRemote.length,
      pageErrors: pageErrors.length,
      unexpectedRequests: proxy.unexpectedRequests.length,
      deniedReceipts: proxy.receipts.filter((row) => row.kind === "denied")
        .length,
      transportNotClosed:
        !transport.closed ||
        transport.openSockets !== 0 ||
        transport.openUpstreamSockets !== 0 ||
        transport.inFlight !== 0 ||
        transport.upstreamRequests !== 0,
    }
    const lateFailure = Object.values(lateFailures).some(Boolean)
    const result = {
      schemaVersion: 1,
      kind: "initialized-native-news-compiled-browser",
      mode,
      status: failure || incompleteCleanup || lateFailure ? "failed" : "passed",
      cases,
      failure,
      deniedRemote,
      pageErrors,
      cleanup,
      browserProcesses:
        browserProcessProof ?? browserProcesses?.snapshot() ?? null,
      finalSourceProof,
      requests: proxy.receipts,
      unexpectedRequests: proxy.unexpectedRequests,
      transport,
      lateFailures,
      compiledFiles: compiled,
      nativeSecurityHeaders: securityHeaders,
      proofScope:
        "real native session/RBAC/API/News transaction and immutable ledger; actual generated UI UUID, network response loss and same-origin browser reload",
      authorityScope:
        "isolated synthetic rr_disposable_news; no staging/provider/login export",
    }
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx", mode: 0o600 }
    )
    if (!failure)
      assert.equal(incompleteCleanup, false, "News fixture cleanup failed")
    if (!failure)
      assert.equal(
        lateFailure,
        false,
        "News final traffic/resource closure failed"
      )
  }
}
