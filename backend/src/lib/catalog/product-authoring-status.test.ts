import { resolveAuthoringVariantStatus } from "./product-authoring-status"

const now = Date.parse("2026-07-26T12:00:00.000Z")

describe("resolveAuthoringVariantStatus", () => {
  it("hides unpublished products without discarding inventory evidence", () => {
    expect(
      resolveAuthoringVariantStatus({
        allowBackorder: false,
        inventoryQuantity: 12,
        manageInventory: true,
        now,
        preorderAllowed: false,
        productStatus: "draft",
      })
    ).toEqual({
      customerStatus: "hidden",
      inventoryQuantity: 12,
      inventoryStatus: "in_stock",
      reason: "The product is not published.",
    })
  })

  it("derives preorder and coming-soon states from the same future date", () => {
    const input = {
      allowBackorder: false,
      inventoryQuantity: 0,
      manageInventory: true,
      now,
      productStatus: "published",
      releaseDate: "2026-08-01T00:00:00.000Z",
    } as const

    expect(
      resolveAuthoringVariantStatus({ ...input, preorderAllowed: true })
    ).toMatchObject({
      customerStatus: "preorder",
      inventoryStatus: "sold_out",
    })
    expect(
      resolveAuthoringVariantStatus({ ...input, preorderAllowed: false })
    ).toMatchObject({
      customerStatus: "coming_soon",
      inventoryStatus: "sold_out",
    })
  })

  it("uses the native backorder flag when managed stock is exhausted", () => {
    expect(
      resolveAuthoringVariantStatus({
        allowBackorder: true,
        inventoryQuantity: 0,
        manageInventory: true,
        now,
        preorderAllowed: false,
        productStatus: "published",
      })
    ).toMatchObject({
      customerStatus: "backorder",
      inventoryQuantity: 0,
      inventoryStatus: "sold_out",
    })
  })

  it.each([
    { customerStatus: "sold_out", inventoryQuantity: 0 },
    { customerStatus: "low_stock", inventoryQuantity: 5 },
    { customerStatus: "in_stock", inventoryQuantity: 6 },
  ] as const)(
    "maps $inventoryQuantity units to $customerStatus",
    ({ customerStatus, inventoryQuantity }) => {
      expect(
        resolveAuthoringVariantStatus({
          allowBackorder: false,
          inventoryQuantity,
          manageInventory: true,
          now,
          preorderAllowed: false,
          productStatus: "published",
        })
      ).toMatchObject({
        customerStatus,
        inventoryQuantity,
      })
    }
  )

  it("distinguishes untracked inventory from an unreadable managed quantity", () => {
    expect(
      resolveAuthoringVariantStatus({
        allowBackorder: false,
        inventoryQuantity: null,
        manageInventory: false,
        now,
        preorderAllowed: false,
        productStatus: "published",
      })
    ).toMatchObject({
      customerStatus: "in_stock",
      inventoryStatus: "not_managed",
    })
    expect(
      resolveAuthoringVariantStatus({
        allowBackorder: false,
        inventoryQuantity: null,
        manageInventory: true,
        now,
        preorderAllowed: false,
        productStatus: "published",
      })
    ).toMatchObject({
      customerStatus: "unknown",
      inventoryStatus: "unknown",
    })
  })
})
