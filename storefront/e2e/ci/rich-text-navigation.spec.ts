import { expect, test } from "@playwright/test"

for (const destination of ["product", "news"] as const) {
  test(`UI runtime ${destination} rich text survives link navigation and browser history`, async ({
    page,
  }, testInfo) => {
    test.skip(
      Boolean(process.env.PLAYWRIGHT_BASE_URL),
      "Local authored rich-text fixtures"
    )
    const failures: string[] = []
    page.on("pageerror", (error) => failures.push(error.message))
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /TrustedHTML|innerHTML/.test(message.text())
      )
        failures.push(message.text())
    })
    if (destination === "product") {
      await page.route("**/api/search/products", (route) =>
        route.fulfill({
          json: {
            hits: [
              {
                id: "prod_CIPRESENTATION",
                handle: "ci-editor-shirt",
                title: "Editor Authored Shirt",
                artist: "Remorseless Records",
                album: "Editor Authored Shirt",
                subtitle: null,
                thumbnail: null,
                collectionTitle: null,
                slug: {
                  artist: "Remorseless Records",
                  album: "Editor Authored Shirt",
                  artistSlug: "remorseless-records",
                  albumSlug: "ci-editor-shirt",
                },
                defaultVariant: {
                  id: "variant_CIPATHOLOGISTCD",
                  title: "S",
                  currency: "usd",
                  amount: 15,
                  hasPrice: true,
                  inStock: true,
                  stockStatus: "in_stock",
                  inventoryQuantity: 10,
                },
                formats: [],
                genres: [],
                metalGenres: [],
                categories: [],
                categoryHandles: [],
                variantTitles: ["S"],
                artistNames: [],
                format: "S",
                priceAmount: 15,
                priceMin: 15,
                priceMax: 15,
                stockStatus: "in_stock",
                productType: "merch",
                status: "published",
              },
            ],
            total: 1,
            offset: 0,
            facets: {},
            hasMore: false,
            nextOffset: 1,
          },
        })
      )
    }
    await page.goto(destination === "product" ? "/catalog" : "/news")
    const consent = page.getByRole("button", {
      name: "Reject non-essential",
      exact: true,
    })
    if (await consent.isVisible()) await consent.click()
    if (destination === "product") {
      await page
        .getByRole("searchbox", {
          name: "Search catalog by product or artist name",
        })
        .fill("shirt")
    }
    const href =
      destination === "product"
        ? "/merch/ci-editor-shirt"
        : "/news/ci-rich-text"
    const link = page.locator(`a[href="${href}"]:visible`).first()
    await expect(link).toBeVisible()
    // The card's center contains its separate Quick shop button on mobile.
    // Click the visible linked title to exercise navigation on every viewport.
    const titleLink = link.getByRole("heading", {
      name:
        destination === "product"
          ? "Editor Authored Shirt"
          : "Rich text navigation dispatch",
      exact: true,
    })
    // A reload would hide the reported bug. Count document requests after the
    // listing hydrates to require an actual App Router transition.
    const documents: string[] = []
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents.push(request.url())
    })
    await titleLink.click()
    const formatted = page.locator(".news-richtext strong", {
      hasText: destination === "product" ? "cotton" : "vinyl",
    })
    await expect(formatted).toBeVisible()
    if (destination === "news") {
      await expect(page.locator(".news-richtext li")).toHaveCount(2)
      await expect(page.getByRole("link", { name: "Unsafe link" })).toHaveCount(
        0
      )
      await expect(page.locator(".news-richtext")).toContainText("<script>")
    }
    await page.goBack()
    await expect(link).toBeVisible()
    await page.goForward()
    await expect(formatted).toBeVisible()
    await page.goBack()
    await titleLink.click()
    await expect(formatted).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "A TRACK SKIPPED", exact: true })
    ).toHaveCount(0)
    expect(documents).toEqual([])
    expect(failures).toEqual([])
    await page.screenshot({
      path: testInfo.outputPath(`${destination}-rich-text-navigation.png`),
      fullPage: true,
    })
  })
}
