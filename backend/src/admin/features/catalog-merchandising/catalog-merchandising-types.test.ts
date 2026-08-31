import {
  shelfListResponseSchema,
  shelfResponseSchema,
} from "./catalog-merchandising-types"

const shelf = {
  archivedAt: null,
  automationType: "none",
  description: null,
  endsAt: null,
  handle: "featured",
  id: "shelf_01",
  isActive: true,
  mode: "manual",
  productLimit: 12,
  ribbonLabel: null,
  ribbonPriority: 100,
  showRibbon: false,
  startsAt: null,
  title: "Featured",
  version: 1,
} as const

const product = {
  endsAt: null,
  id: "shelf_product_01",
  isPinned: false,
  productId: "prod_01",
  productProfileId: null,
  shelfId: shelf.id,
  sortOrder: 0,
  startsAt: null,
} as const

describe("catalog merchandising response contracts", () => {
  it("accepts a bounded shelf page and projects unknown fields", () => {
    expect(
      shelfListResponseSchema.parse({
        count: 1,
        ignored: "provider detail",
        limit: 100,
        offset: 0,
        shelves: [{ products: [product], shelf }],
      })
    ).toEqual({
      count: 1,
      limit: 100,
      offset: 0,
      shelves: [{ products: [product], shelf }],
    })
  })

  it("rejects product rows attached to another shelf", () => {
    expect(
      shelfResponseSchema.safeParse({
        products: [{ ...product, shelfId: "shelf_other" }],
        shelf,
      }).success
    ).toBe(false)
  })

  it("rejects duplicate shelf identities", () => {
    const response = { products: [product], shelf }
    expect(
      shelfListResponseSchema.safeParse({
        count: 2,
        limit: 100,
        offset: 0,
        shelves: [response, response],
      }).success
    ).toBe(false)
  })
})
