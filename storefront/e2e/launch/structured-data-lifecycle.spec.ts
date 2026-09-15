import { expect, test, type Page } from "@playwright/test"

import { serializeJsonLd } from "@/lib/seo/json-ld"

import { installCatalog } from "./launch-fixtures"

const productPath = "/music-release/pathologist-pathological-decomposition"
const productId = "product-json-prod_CIPATHOLOGIST"
const rootIds = ["remorseless-organization", "remorseless-website"]
const dataSelector = "script[type='application/ld+json']"

const readDataBlocks = async (page: Page) =>
  page.locator(dataSelector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const data: unknown = JSON.parse(node.textContent ?? "")
      return {
        id: node.id,
        nonce: node instanceof HTMLScriptElement ? node.nonce : "",
        data,
      }
    })
  )

const expectDataIds = async (page: Page, routeId: string): Promise<void> => {
  await expect
    .poll(async () => (await readDataBlocks(page)).map(({ id }) => id).sort())
    .toEqual([...rootIds, routeId].sort())
}

for (const route of [
  { path: "/catalog", id: "catalog-item-list" },
  { path: productPath, id: productId },
]) {
  test(`structured data remains in server HTML without JavaScript: ${route.path}`, async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Structured data requires a base URL")
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    })
    try {
      const page = await context.newPage()
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
      })
      expect(response?.status()).toBe(200)
      const policy = response?.headers()["content-security-policy"] ?? ""
      const nonce = /'nonce-([^']+)'/u.exec(policy)?.[1]
      expect(nonce).toBeTruthy()
      expect(policy).toContain("require-trusted-types-for 'script'")
      expect(policy.split("; ")).toContain(
        "trusted-types nextjs nextjs#bundler remorseless-stripe-js remorseless-json-ld"
      )
      await expectDataIds(page, route.id)
      const blocks = await readDataBlocks(page)
      expect(blocks.every((block) => block.nonce === nonce)).toBe(true)
      expect(blocks.find((block) => block.id === route.id)?.data).toEqual(
        route.id === "catalog-item-list"
          ? expect.objectContaining({ "@type": "ItemList" })
          : expect.arrayContaining([
              expect.objectContaining({ "@type": "Product" }),
            ])
      )
    } finally {
      await context.close()
    }
  })
}

test("structured data follows hydrated catalog and Product SPA history without stale blocks or Trusted Types errors", async ({
  page,
}) => {
  const errors: string[] = []
  const violations: string[] = []
  page.on("pageerror", (error) => errors.push(error.name))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 200))
  })
  await page.exposeFunction(
    "__recordStructuredDataViolation",
    (value: unknown) => {
      if (typeof value === "string") violations.push(value)
    }
  )
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const record: unknown = Reflect.get(
        globalThis,
        "__recordStructuredDataViolation"
      )
      if (typeof record === "function") record(event.effectiveDirective)
    })
  })
  await installCatalog(page)
  await page.goto("/catalog", { waitUntil: "domcontentloaded" })
  await expectDataIds(page, "catalog-item-list")
  const reject = page.getByRole("button", { name: "Reject non-essential" })
  if (await reject.isVisible()) await reject.click()
  // SSR emits these blocks in the body. Their presence in head proves the
  // client effects have replaced those initial nodes before identity capture.
  await expect(page.locator("head #remorseless-organization")).toHaveCount(1)
  await expect(page.locator("head #remorseless-website")).toHaveCount(1)
  await expect(page.locator("head #catalog-item-list")).toHaveCount(1)
  await expectDataIds(page, "catalog-item-list")
  const initialRoots = (await readDataBlocks(page)).filter(({ id }) =>
    rootIds.includes(id)
  )
  const rootHandles = await page
    .locator("#remorseless-organization, #remorseless-website")
    .elementHandles()
  const initialTimeOrigin = await page.evaluate(() => performance.timeOrigin)

  for (let visit = 0; visit < 2; visit += 1) {
    await page.locator(`a[href='${productPath}']`).first().click()
    await expect(page).toHaveURL(new RegExp(`${productPath}$`, "u"))
    await expectDataIds(page, productId)
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      initialTimeOrigin
    )
    await page.goBack()
    await expect(page).toHaveURL(/\/catalog$/u)
    await expectDataIds(page, "catalog-item-list")
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      initialTimeOrigin
    )
  }

  expect(
    (await readDataBlocks(page)).filter(({ id }) => rootIds.includes(id))
  ).toEqual(initialRoots)
  for (const handle of rootHandles) {
    expect(await handle.evaluate((node) => node.isConnected)).toBe(true)
    await handle.dispose()
  }
  expect(violations).toEqual([])
  expect(errors).toEqual([])
})

test("the JSON-only policy keeps hostile data inert and rejects noncanonical data and executable text", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const factory: unknown = Reflect.get(globalThis, "trustedTypes")
    if (typeof factory !== "object" || factory === null) {
      throw new Error("Trusted Types must be supported for this regression")
    }
    const createPolicy: unknown = Reflect.get(factory, "createPolicy")
    if (typeof createPolicy !== "function")
      throw new Error("Missing policy factory")
    Reflect.set(factory, "createPolicy", (name: string, rules: unknown) => {
      const policy: unknown = Reflect.apply(createPolicy, factory, [
        name,
        rules,
      ])
      if (name === "remorseless-json-ld") {
        Reflect.set(globalThis, "__jsonLdPolicyUnderTest", policy)
        Reflect.set(factory, "createPolicy", createPolicy)
      }
      return policy
    })
  })
  await page.goto("/catalog", { waitUntil: "domcontentloaded" })
  await expect(page.locator("head #catalog-item-list")).toHaveCount(1)
  const hostile = {
    "@type": "Thing",
    name: "</script><script>globalThis.__structuredDataHostile=true</script>",
    description:
      "<img src=x onerror=globalThis.__structuredDataHostile=true> & \u2028\u2029",
  }
  const result = await page.evaluate(
    async ({ data, serialized, rejectedInputs }) => {
      const policy: unknown = Reflect.get(globalThis, "__jsonLdPolicyUnderTest")
      if (typeof policy !== "object" || policy === null)
        throw new Error("App JSON policy was not created")
      const createScript: unknown = Reflect.get(policy, "createScript")
      if (typeof createScript !== "function")
        throw new Error("Missing script capability")
      const violations: string[] = []
      document.addEventListener("securitypolicyviolation", (event) => {
        violations.push(event.effectiveDirective)
      })
      const nonce =
        document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce
      if (!nonce) throw new Error("The document has no script nonce")
      const dataNodes = serialized.map((candidate) => {
        const node = document.createElement("script")
        node.type = "application/ld+json"
        node.nonce = nonce
        Reflect.set(
          node,
          "text",
          Reflect.apply(createScript, policy, [candidate])
        )
        document.head.appendChild(node)
        return node
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const dataPhase = {
        values: dataNodes.map((node) => JSON.parse(node.text)),
        expected: [data, [data]],
        inert: dataNodes.every(
          (node) => node.children.length === 0 && !node.hasAttribute("src")
        ),
        executed: Reflect.get(globalThis, "__structuredDataHostile") === true,
        violations: violations.splice(0),
      }
      const rejected = rejectedInputs.map((candidate) => {
        try {
          Reflect.apply(createScript, policy, [candidate])
          return false
        } catch (error) {
          return error instanceof TypeError
        }
      })
      const deniedCapabilities = ["createHTML", "createScriptURL"].map(
        (name) => {
          const method: unknown = Reflect.get(policy, name)
          if (typeof method !== "function") return false
          try {
            Reflect.apply(method, policy, ["https://example.invalid/script.js"])
            return false
          } catch (error) {
            return error instanceof TypeError
          }
        }
      )
      const script = document.createElement("script")
      script.nonce = nonce
      script.appendChild(
        document.createTextNode("globalThis.__structuredDataExecutable = true")
      )
      document.head.appendChild(script)
      await new Promise((resolve) => setTimeout(resolve, 50))
      script.remove()
      for (const node of dataNodes) node.remove()
      return {
        dataPhase,
        rejected,
        deniedCapabilities,
        executed:
          Reflect.get(globalThis, "__structuredDataExecutable") === true,
        violations,
      }
    },
    {
      data: hostile,
      serialized: [serializeJsonLd(hostile), serializeJsonLd([hostile])],
      rejectedInputs: [
        "globalThis.__structuredDataExecutable=true",
        "{};globalThis.__structuredDataExecutable=true",
        "<script>globalThis.__structuredDataExecutable=true</script>",
        "true",
        "null",
        '"plain text"',
        '[{"name":"ok"},1]',
        '{ "name": "ok" }',
        '{"name":"first","name":"second"}',
        '{"name":"<script>&"}',
        '{"name":"\\u0041"}',
        '{"number":1e400}',
        serializeJsonLd({ name: "x".repeat(1_048_576) }),
      ],
    }
  )
  expect(result.dataPhase.values).toEqual(result.dataPhase.expected)
  expect(result.dataPhase.inert).toBe(true)
  expect(result.dataPhase.executed).toBe(false)
  expect(result.dataPhase.violations).toEqual([])
  expect(result.rejected).toEqual(Array(13).fill(true))
  expect(result.deniedCapabilities).toEqual([true, true])
  expect(result.executed).toBe(false)
  expect(result.violations).toContain("require-trusted-types-for")
})
