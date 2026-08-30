import { renderToStaticMarkup } from "react-dom/server"

import { CatalogShelfList } from "./catalog-shelf-list"
import type { ShelfResponse } from "./catalog-merchandising-types"

const buildShelf = ({
  archivedAt = null,
  automationType = "none",
  id,
  isActive = true,
  mode = "manual",
  productCount = 0,
  title,
}: {
  archivedAt?: string | null
  automationType?: "new_release" | "none"
  id: string
  isActive?: boolean
  mode?: "automatic" | "hybrid" | "manual"
  productCount?: number
  title: string
}): ShelfResponse => ({
  products: Array.from({ length: productCount }, (_, index) => ({
    endsAt: null,
    id: `shelf-product-${index}`,
    isPinned: false,
    productId: `product-${index}`,
    productProfileId: null,
    shelfId: id,
    sortOrder: index,
    startsAt: null,
  })),
  shelf: {
    archivedAt,
    automationType,
    description: null,
    endsAt: null,
    handle: id,
    id,
    isActive,
    mode,
    productLimit: null,
    ribbonLabel: null,
    ribbonPriority: 100,
    showRibbon: false,
    startsAt: null,
    title,
    version: 1,
  },
})

describe("CatalogShelfList", () => {
  it("renders accessible selected rows with merchant-facing status labels", () => {
    const markup = renderToStaticMarkup(
      <CatalogShelfList
        onSelect={jest.fn()}
        selectedShelfId="new-releases"
        shelves={[
          buildShelf({
            automationType: "new_release",
            id: "new-releases",
            mode: "automatic",
            title: "Newest arrivals",
          }),
          buildShelf({
            archivedAt: "2026-08-02T04:00:00.000Z",
            id: "archive",
            isActive: false,
            productCount: 1,
            title: "Archive",
          }),
        ]}
      />
    )

    expect(markup).toContain('aria-label="Merchandising shelves"')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain("Automatic · New releases")
    expect(markup).toContain("Archived")
    expect(markup).toContain("1 product")
    expect(markup).not.toContain("new_release")
  })
})
