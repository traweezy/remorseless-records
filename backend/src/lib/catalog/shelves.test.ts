import {
  getNewReleaseLookbackDays,
  isCatalogShelfActive,
  isNewReleaseCandidate,
  resolveShelfProductIds,
} from "./shelves"

const now = new Date("2026-07-21T12:00:00.000Z")

describe("catalog shelf resolution", () => {
  it("honors shelf and membership schedules", () => {
    expect(
      isCatalogShelfActive(
        {
          is_active: true,
          starts_at: "2026-07-01T00:00:00.000Z",
          ends_at: "2026-08-01T00:00:00.000Z",
        },
        now
      )
    ).toBe(true)
    expect(
      isCatalogShelfActive(
        { is_active: true, starts_at: "2026-08-01T00:00:00.000Z" },
        now
      )
    ).toBe(false)

    const productIds = resolveShelfProductIds({
      shelf: { mode: "manual", is_active: true, product_limit: 10 },
      memberships: [
        { product_id: "prod_2", sort_order: 2 },
        { product_id: "prod_1", sort_order: 1 },
        {
          product_id: "prod_future",
          sort_order: 0,
          starts_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      automaticProductIds: [],
      visibleProductIds: new Set(["prod_1", "prod_2", "prod_future"]),
      now,
    })

    expect(productIds).toEqual(["prod_1", "prod_2"])
  })

  it("pins manual products ahead of automatic hybrid results", () => {
    const productIds = resolveShelfProductIds({
      shelf: { mode: "hybrid", is_active: true, product_limit: 4 },
      memberships: [
        { product_id: "prod_manual", sort_order: 2 },
        { product_id: "prod_pinned", sort_order: 10, is_pinned: true },
      ],
      automaticProductIds: ["prod_auto_1", "prod_pinned", "prod_auto_2"],
      visibleProductIds: new Set([
        "prod_manual",
        "prod_pinned",
        "prod_auto_1",
        "prod_auto_2",
      ]),
      now,
    })

    expect(productIds).toEqual([
      "prod_pinned",
      "prod_auto_1",
      "prod_auto_2",
      "prod_manual",
    ])
  })

  it("filters unpublished products and applies a bounded product limit", () => {
    const productIds = resolveShelfProductIds({
      shelf: { mode: "automatic", is_active: true, product_limit: 2 },
      memberships: [],
      automaticProductIds: ["prod_1", "prod_hidden", "prod_2", "prod_3"],
      visibleProductIds: new Set(["prod_1", "prod_2", "prod_3"]),
      now,
    })

    expect(productIds).toEqual(["prod_1", "prod_2"])
  })

  it("uses release dates and a configurable new-release window", () => {
    const shelf = {
      mode: "automatic",
      automation_type: "new_release",
      is_active: true,
      metadata: { lookbackDays: 45 },
    }

    expect(getNewReleaseLookbackDays(shelf)).toBe(45)
    expect(
      isNewReleaseCandidate({
        shelf,
        releaseDate: "2026-07-01T00:00:00.000Z",
        now,
      })
    ).toBe(true)
    expect(
      isNewReleaseCandidate({
        shelf,
        releaseDate: "2026-05-01T00:00:00.000Z",
        now,
      })
    ).toBe(false)
    expect(
      isNewReleaseCandidate({
        shelf,
        releaseDate: "2026-08-01T00:00:00.000Z",
        now,
      })
    ).toBe(false)
  })
})
