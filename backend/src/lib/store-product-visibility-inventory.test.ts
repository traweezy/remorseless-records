import { readFileSync } from "node:fs"
import path from "node:path"

const storeApiRoot = path.join(__dirname, "../api/store")
const productBoundaryRoutes = [
  "catalog/products/[handle]/bundle/route.ts",
  "catalog/shelves/route.ts",
  "discography/route.ts",
  "products/[handle]/related/route.ts",
  "products/handles/route.ts",
] as const

describe("custom Store product visibility inventory", () => {
  it.each(productBoundaryRoutes)(
    "%s resolves the publishable-key visibility boundary",
    (relativePath) => {
      const source = readFileSync(path.join(storeApiRoot, relativePath), "utf8")

      expect(source).toContain("resolveStoreProductVisibility")
      expect(source).toMatch(/listVisibleProduct(?:Page|sByIds)/u)
      expect(source).toContain('"x-publishable-api-key"')
    }
  )

  it("keeps the legacy related-products full scan retired", () => {
    const source = readFileSync(
      path.join(storeApiRoot, "products/[handle]/related/route.ts"),
      "utf8"
    )

    expect(source).not.toContain("take: 1000")
    expect(source).not.toContain("Modules.PRODUCT")
  })
})
