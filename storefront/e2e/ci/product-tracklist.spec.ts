import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("UI runtime home and catalog expose their main page heading", async ({
  page,
}) => {
  for (const [path, name] of [
    ["/", "Remorseless Records"],
    ["/catalog", "Catalog"],
    ["/products", "Catalog"],
  ]) {
    await page.goto(path)
    const headings = page.locator("main h1")
    await expect(headings).toHaveCount(1)
    await expect(headings).toHaveText(name)
  }
})

test("UI runtime authored track numbers appear once without changing titles", async ({
  page,
}, testInfo) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "Local numbered tracklist fixture"
  )
  const failures: string[] = []
  page.on("pageerror", (error) => failures.push(error.message))
  await page.goto("/music-release/ci-numbered-tracklist")
  const consent = page.getByRole("button", {
    name: "Reject non-essential",
    exact: true,
  })
  if (await consent.isVisible()) await consent.click()
  const heading = page.getByRole("heading", { name: "Tracklist", exact: true })
  await expect(heading).toBeVisible()
  await expect(heading).toHaveJSProperty("tagName", "H2")
  const list = heading.locator("..").getByRole("list")
  await expect(list.getByRole("listitem")).toHaveText([
    "1. Exhumed Remains",
    "2. Pathological Decomposition",
  ])
  expect(failures).toEqual([])
  expect(
    (await new AxeBuilder({ page }).include("main").analyze()).violations
  ).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath("authored-tracklist.png"),
    fullPage: true,
  })
})
