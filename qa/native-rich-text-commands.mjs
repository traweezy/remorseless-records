import assert from "node:assert/strict"

const editor = '[role="dialog"] [role="textbox"][aria-label="Post body"]'
const linkInput = '[role="dialog"] input#rich-text-link'
const deadline = (operation) => {
  let timer
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Owned editor write was not observed")),
        15_000
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
const selectAll = async (page, selector = editor) => {
  await page.click(selector)
  await page.keyboard.down("Control")
  try {
    await page.keyboard.press("KeyA")
  } finally {
    await page.keyboard.up("Control")
  }
}
const readEditor = (page) =>
  page.$eval(editor, (node) => ({
    html: node.innerHTML,
    text: node.textContent,
    tags: [...node.querySelectorAll("*")].map((item) =>
      item.tagName.toLowerCase()
    ),
    links: [...node.querySelectorAll("a")].map((item) => ({
      href: item.getAttribute("href"),
      text: item.textContent,
    })),
  }))
const waitTag = (page, tag, present = true) =>
  page.waitForFunction(
    (selector, name, expected) =>
      Boolean(document.querySelector(selector)?.querySelector(name)) ===
      expected,
    { timeout: 5_000 },
    editor,
    tag,
    present
  )
const replaceText = async (page, value) => {
  await selectAll(page)
  await page.keyboard.press("Backspace")
  await page.keyboard.type(value)
  await page.waitForFunction(
    (selector, expected) =>
      document.querySelector(selector)?.textContent === expected,
    { timeout: 5_000 },
    editor,
    value
  )
}
const shortcut = async (page, key, shift = false) => {
  await page.click(editor)
  await page.keyboard.down("Control")
  if (shift) await page.keyboard.down("Shift")
  try {
    await page.keyboard.press(key)
  } finally {
    if (shift) await page.keyboard.up("Shift")
    await page.keyboard.up("Control")
  }
}

// Exercises the real compiled component through native pointer/keyboard events.
// No HTML injection, React/SDK access, replacement save handler or new proxy
// permission is used. The outgoing UI request is paused only to verify it and
// arm the existing exact-body guard before the original request continues.
export const runNativeRichTextCommands = async ({
  page,
  fixture,
  proxy,
  post,
  openEditor,
  click,
  keyboardActivate,
  checkpoint,
  waitClosed,
  commandProof,
  interceptNextWrite,
}) => {
  const interactions = []
  await openEditor(page, post)
  await page.waitForSelector(editor, { timeout: 15_000 })
  assert.equal(
    await page.$$eval(
      '[role="dialog"] [role="toolbar"]',
      (nodes) => nodes.length
    ),
    1
  )
  const before = proxy.receipts.length
  const toolbar = '[role="dialog"] [role="toolbar"]'
  const toolbarLabels = [
    "Text",
    "H2",
    "H3",
    "Bold",
    "Italic",
    "Underline",
    "Quote",
    "Bullets",
    "Numbers",
    "Clear style",
    "Link",
  ]
  const toolbarState = () =>
    page.$eval(toolbar, (node) => ({
      focused: node.contains(document.activeElement)
        ? document.activeElement.textContent?.trim()
        : null,
      tabStops: [...node.querySelectorAll("button")]
        .filter((button) => button.tabIndex === 0 && !button.disabled)
        .map((button) => button.textContent?.trim()),
    }))
  const assertToolbarState = async (label) => {
    await page.waitForFunction(
      (selector, expected) => {
        const node = document.querySelector(selector)
        const active = document.activeElement
        const stops = [...(node?.querySelectorAll("button") ?? [])].filter(
          (button) => button.tabIndex === 0 && !button.disabled
        )
        return (
          node?.contains(active) &&
          active?.textContent?.trim() === expected &&
          stops.length === 1 &&
          stops[0] === active
        )
      },
      { timeout: 2000 },
      toolbar,
      label
    )
    assert.deepEqual(await toolbarState(), {
      focused: label,
      tabStops: [label],
    })
  }
  await page.click(editor)
  await page.keyboard.down("Shift")
  try {
    await page.keyboard.press("Tab")
  } finally {
    await page.keyboard.up("Shift")
  }
  await assertToolbarState("Text")
  for (const label of toolbarLabels.slice(1)) {
    await page.keyboard.press("ArrowRight")
    await assertToolbarState(label)
  }
  for (const [key, label] of [
    ["ArrowRight", "Text"],
    ["ArrowLeft", "Link"],
    ["Home", "Text"],
    ["End", "Link"],
    ["Home", "Text"],
  ]) {
    await page.keyboard.press(key)
    await assertToolbarState(label)
  }
  await page.keyboard.press("Tab")
  assert.equal(
    await page.$eval(editor, (node) => node === document.activeElement),
    true
  )
  interactions.push({
    control: "Text formatting toolbar",
    keyboardLabels: toolbarLabels,
    oneTabStop: true,
    arrowsWrap: true,
    homeEndReachEdges: true,
    nativeTabReachesEditor: true,
  })
  const copy = "Owned editor selection"
  await replaceText(page, copy)
  for (const [label, tag] of [
    ["H2", "h2"],
    ["H3", "h3"],
    ["Quote", "blockquote"],
    ["Text", "p"],
    ["Bullets", "ul"],
    ["Numbers", "ol"],
  ]) {
    await selectAll(page)
    await click(page, label)
    await waitTag(page, tag)
    assert.equal((await readEditor(page)).text, copy)
    interactions.push({ control: label, intendedTag: tag, textPreserved: true })
  }
  await selectAll(page)
  await click(page, "Clear style")
  await waitTag(page, "p")
  for (const tag of ["h2", "h3", "blockquote", "ul", "ol"])
    await waitTag(page, tag, false)
  interactions.push({ control: "Clear style", paragraphRestored: true })

  for (const label of ["Bold", "Italic", "Underline"]) {
    await selectAll(page)
    await click(page, label)
    await page.waitForFunction(
      (name) =>
        [
          ...document.querySelectorAll(
            '[role="dialog"] [role="toolbar"] button'
          ),
        ].some(
          (button) =>
            button.textContent?.trim() === name &&
            button.getAttribute("aria-pressed") === "true"
        ),
      { timeout: 5_000 },
      label
    )
    assert.equal((await readEditor(page)).text, copy)
    interactions.push({ control: label, pressed: true, textPreserved: true })
  }
  await checkpoint("editor-inline-and-block-formatting", {
    interactions: [...interactions],
    rendered: await readEditor(page),
  })

  await selectAll(page)
  await click(page, "Clear style")
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          '[role="dialog"] [role="toolbar"] button[aria-pressed]'
        ),
      ].every((button) => button.getAttribute("aria-pressed") === "false"),
    { timeout: 5_000 }
  )
  await selectAll(page)
  await click(page, "Link")
  await page.waitForSelector(linkInput)
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "//example.invalid/story",
    "example.invalid/story",
    "",
  ]) {
    await selectAll(page, linkInput)
    await page.keyboard.press("Backspace")
    if (value) await page.keyboard.type(value)
    await click(page, "Apply")
    await page.waitForSelector('[role="dialog"] input[aria-invalid="true"]')
    assert.equal(
      await page.$eval(linkInput, (node) =>
        node.getAttribute("aria-describedby")
      ),
      "rich-text-link-error"
    )
    assert.match(
      await page.$eval("#rich-text-link-error", (node) => node.textContent),
      /complete http, https, or mailto URL/u
    )
    assert.deepEqual((await readEditor(page)).links, [])
    interactions.push({
      control: "Apply",
      rejectedSchemeOrIncomplete: value,
      noLinkCreated: true,
    })
  }
  await checkpoint("editor-invalid-link-validation", {
    interactions: interactions.slice(-5),
    rendered: await readEditor(page),
  })
  // Closing the panel is a UI action; no saved command or native write exists.
  await click(page, "Link")
  for (const destination of [
    "http://example.invalid/story",
    "https://example.invalid/story",
    "mailto:editor@example.invalid",
  ]) {
    await selectAll(page)
    await click(page, "Link")
    await page.waitForSelector(linkInput)
    await page.type(linkInput, destination)
    await click(page, "Apply")
    await waitTag(page, "a")
    assert.deepEqual((await readEditor(page)).links, [
      { href: destination, text: copy },
    ])
    await selectAll(page)
    await click(page, "Link")
    await click(page, "Remove link")
    await waitTag(page, "a", false)
    assert.equal((await readEditor(page)).text, copy)
    interactions.push({
      control: "Link/Apply/Remove link",
      destination,
      selectedTextPreserved: true,
    })
  }
  await checkpoint("editor-valid-links-and-remove", {
    interactions: interactions.slice(-3),
    rendered: await readEditor(page),
  })

  const historyCopy = "Owned editor history"
  await replaceText(page, historyCopy)
  await shortcut(page, "KeyZ")
  await page.waitForFunction(
    (selector, inserted) =>
      document.querySelector(selector)?.textContent !== inserted,
    { timeout: 5_000 },
    editor,
    historyCopy
  )
  const undone = await readEditor(page)
  await shortcut(page, "KeyZ", true)
  await page.waitForFunction(
    (selector, expected) =>
      document.querySelector(selector)?.textContent === expected,
    { timeout: 5_000 },
    editor,
    historyCopy
  )
  interactions.push({
    control: "Ctrl+Z/Ctrl+Shift+Z",
    undoneText: undone.text,
    redoneText: historyCopy,
  })
  await checkpoint("editor-native-history-shortcuts", {
    history: interactions.at(-1),
  })

  const finalCopy = "Owned editor published copy"
  const finalLink = "https://example.invalid/native-editor"
  await replaceText(page, finalCopy)
  await selectAll(page)
  await click(page, "Clear style")
  for (const label of ["H2", "Bold", "Underline"]) {
    await selectAll(page)
    await click(page, label)
  }
  await selectAll(page)
  await click(page, "Link")
  await page.waitForSelector(linkInput)
  await page.type(linkInput, finalLink)
  await click(page, "Apply")
  await waitTag(page, "a")
  assert.equal((await readEditor(page)).text, finalCopy)
  assert.equal(proxy.commandSnapshot(), null)
  assert.equal(
    proxy.receipts.slice(before).some((row) => row.method === "PUT"),
    false,
    "Formatting sent a native News write"
  )
  await checkpoint("editor-composed-rich-content-before-save", {
    rendered: await readEditor(page),
    noNativeWriteBeforeSave: true,
  })

  let resolveWrite, rejectWrite
  const write = new Promise((resolve, reject) => {
    resolveWrite = resolve
    rejectWrite = reject
  })
  // The rejection is still awaited below; avoid a race with the asynchronous
  // pointer/keyboard activation returning after an intercepted request fails.
  void write.catch(() => {})
  interceptNextWrite(async (request) => {
    try {
      assert.equal(new URL(request.url()).pathname, `/admin/news/${post.id}`)
      const body = JSON.parse(request.postData())
      assert.equal(body.expectedActorId, fixture.actors.first.id)
      assert.equal(body.expectedVersion, post.version)
      assert.match(
        body.idempotencyKey,
        /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
      )
      const {
        expectedActorId: _actor,
        expectedVersion: _version,
        idempotencyKey: _key,
        ...input
      } = body
      const { content, ...fields } = input
      assert.deepEqual(fields, {
        title: post.title,
        excerpt: null,
        coverUrl: null,
        coverAltText: null,
        tags: [],
        publishedAt: null,
        status: "published",
      })
      const sanitized = fixture.sanitizeContent(content)
      const markup = await page.evaluate(
        (html, expectedText, expectedLink) => {
          const document = new DOMParser().parseFromString(html, "text/html")
          const nodes = [...document.body.querySelectorAll("*")]
          const links = [...document.body.querySelectorAll("a")]
          return {
            textMatches: document.body.textContent === expectedText,
            roots: [...document.body.children].map((node) => node.tagName),
            tags: nodes.map((node) => node.tagName),
            boldMatches: nodes.some(
              (node) =>
                node.tagName === "STRONG" && node.textContent === expectedText
            ),
            underlineMatches: nodes.some(
              (node) =>
                node.tagName === "U" && node.textContent === expectedText
            ),
            linkMatches:
              links.length === 1 &&
              links[0].getAttribute("href") === expectedLink &&
              links[0].textContent === expectedText,
            safeLink:
              links.length === 1 &&
              links[0].getAttribute("target") === "_blank" &&
              links[0].getAttribute("rel") === "noopener noreferrer",
            unexpectedAttributes: nodes.flatMap((node) =>
              [...node.attributes]
                .filter(
                  (attribute) =>
                    node.tagName !== "A" ||
                    !["href", "target", "rel"].includes(attribute.name)
                )
                .map((attribute) => attribute.name)
            ),
          }
        },
        sanitized,
        finalCopy,
        finalLink
      )
      assert.equal(markup.textMatches, true)
      assert.deepEqual(markup.roots, ["H2"])
      // Lexical may wrap strong text in a redundant, sanitizer-approved B.
      // Verify the intended semantics and reject every other extra tag.
      assert.deepEqual(
        [...new Set(markup.tags.filter((tag) => tag !== "B"))].sort(),
        ["A", "H2", "STRONG", "U"].sort()
      )
      assert.equal(markup.boldMatches, true)
      assert.equal(markup.underlineMatches, true)
      assert.equal(markup.linkMatches, true)
      assert.equal(markup.safeLink, true)
      assert.deepEqual(markup.unexpectedAttributes, [])
      proxy.armNewsUpdate({
        entryId: post.id,
        expectedActorId: fixture.actors.first.id,
        expectedVersion: post.version,
        bodyWithoutCommandFields: input,
      })
      resolveWrite({ body, sanitized, markup })
    } catch (error) {
      rejectWrite(error)
      throw error
    }
  })
  const publishFocus = await keyboardActivate(page, "Publish changes")
  const outgoing = await deadline(write)
  await waitClosed(page)
  const saved = await fixture.entry(post.id)
  assert.equal(saved.version, post.version + 1)
  assert.equal(saved.status, "published")
  assert.equal(saved.content, outgoing.sanitized)
  const proof = await commandProof(post)
  assert.deepEqual(proof.command.body, outgoing.body)
  assert.equal(proof.command.putCount, 1)
  assert.equal(proof.command.proof, "accepted")
  const publicPost = await fixture.publicEntry(post.id)
  assert.equal(publicPost.content, outgoing.sanitized)
  assert.equal(publicPost.version, saved.version)
  assert.equal(publicPost.status, "published")
  await checkpoint("editor-exact-native-save-and-sanitized-public-readback", {
    publishFocus,
    saved,
    publicPost,
    proof,
    outgoingMarkup: outgoing.markup,
  })
  proxy.finishCommand()
}
