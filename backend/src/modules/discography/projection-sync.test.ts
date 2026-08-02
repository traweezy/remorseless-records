import { planDiscographyProjectionSync } from "./projection-sync"

describe("discography projection reconciliation", () => {
  it("updates linked releases, creates new ones, retains manual history, and archives stale links", () => {
    const archivedAt = new Date("2026-08-02T06:00:00.000Z")
    const plan = planDiscographyProjectionSync(
      [
        { product_id: "prod_existing", title: "Updated", version: 1 },
        { product_id: "prod_new", title: "New", version: 1 },
      ],
      [
        {
          id: "disc_existing",
          product_id: "prod_existing",
          source_mode: "catalog_product",
          version: 4,
        },
        {
          id: "disc_stale",
          product_id: "prod_stale",
          source_mode: "catalog_product",
          version: 2,
        },
        {
          archived_at: "2026-08-01T00:00:00.000Z",
          id: "disc_already_archived",
          product_id: "prod_old",
          source_mode: "catalog_product",
          version: 7,
        },
        {
          id: "disc_manual",
          product_id: null,
          source_mode: "manual",
          version: 3,
        },
      ],
      archivedAt
    )

    expect(plan).toEqual({
      archives: [
        {
          archived_at: archivedAt,
          id: "disc_stale",
          version: 3,
        },
      ],
      creates: [{ product_id: "prod_new", title: "New", version: 1 }],
      retainedManual: 1,
      updates: [
        {
          id: "disc_existing",
          product_id: "prod_existing",
          title: "Updated",
          version: 5,
        },
      ],
    })
  })
})
