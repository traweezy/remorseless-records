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

  it("preserves an operator archive when a release remains projected", () => {
    expect(
      planDiscographyProjectionSync(
        [{ product_id: "prod_returned", title: "Returned", version: 1 }],
        [
          {
            archived_at: "2026-08-01T00:00:00.000Z",
            id: "disc_returned",
            product_id: "prod_returned",
            source_mode: "catalog_product",
            version: 4,
          },
        ],
        new Date("2026-08-31T05:00:00.000Z")
      ).updates
    ).toEqual([
      {
        id: "disc_returned",
        product_id: "prod_returned",
        title: "Returned",
        version: 5,
      },
    ])
  })

  it.each([
    [
      "duplicate projected Product links",
      [
        { product_id: "prod_1", version: 1 },
        { product_id: "prod_1", version: 1 },
      ],
      [],
    ],
    [
      "duplicate persisted Product links",
      [],
      [
        {
          id: "disc_1",
          product_id: "prod_1",
          source_mode: "catalog_product",
          version: 1,
        },
        {
          id: "disc_2",
          product_id: "prod_1",
          source_mode: "catalog_product",
          version: 1,
        },
      ],
    ],
    [
      "versions that cannot advance safely",
      [],
      [
        {
          id: "disc_1",
          product_id: "prod_1",
          source_mode: "catalog_product",
          version: Number.MAX_SAFE_INTEGER,
        },
      ],
    ],
  ])("rejects %s", (_label, projected, existing) => {
    expect(() =>
      planDiscographyProjectionSync(
        projected,
        existing,
        new Date("2026-08-31T05:00:00.000Z")
      )
    ).toThrow()
  })
})
