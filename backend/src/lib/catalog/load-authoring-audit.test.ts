import { Modules } from "@medusajs/framework/utils"

import { catalogProductProfileFixture } from "./transaction-persistence-fixtures.test-helpers"
import { loadCatalogAuthoringAudit } from "./load-authoring-audit"

const product = (index: number) => ({
  handle: `release-${index}`,
  id: `prod_${index.toString().padStart(3, "0")}`,
  metadata: {},
  status: "published",
  title: `Release ${index}`,
  type: { value: "Music release" },
})

const reference = {
  created_at: "2026-08-30T00:00:00.000Z",
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "product_type",
  label: "Music release",
  metadata: {},
  rank: 0,
  updated_at: "2026-08-30T00:00:00.000Z",
  value: "music-release",
}

const containerFixture = ({
  bundles = [],
  products,
  profiles = [],
  references = [reference],
}: {
  bundles?: unknown[]
  products: unknown[]
  profiles?: unknown[]
  references?: unknown[]
}) => {
  const paginate = (records: unknown[], skip: number, take: number) => [
    records.slice(skip, skip + take),
    records.length,
  ]
  const productService = {
    listAndCountProducts: jest.fn(
      async (_filters: unknown, config: { skip: number; take: number }) =>
        paginate(products, config.skip, config.take)
    ),
  }
  const catalogService = {
    listAndCountCatalogBundleProfiles: jest.fn(
      async (_filters: unknown, config: { skip: number; take: number }) =>
        paginate(bundles, config.skip, config.take)
    ),
    listAndCountCatalogProductProfiles: jest.fn(
      async (_filters: unknown, config: { skip: number; take: number }) =>
        paginate(profiles, config.skip, config.take)
    ),
    listAndCountCatalogReferenceValues: jest.fn(
      async (_filters: unknown, config: { skip: number; take: number }) =>
        paginate(references, config.skip, config.take)
    ),
  }
  const container = {
    resolve: jest.fn((key: string) =>
      key === Modules.PRODUCT ? productService : catalogService
    ),
  }
  return { catalogService, container, productService }
}

describe("loadCatalogAuthoringAudit", () => {
  it("loads every stable page with deterministic ordering and complete contracts", async () => {
    const products = Array.from({ length: 251 }, (_, index) => product(index))
    const profiles = products.map((entry, index) =>
      catalogProductProfileFixture({
        id: `cprof_${index.toString().padStart(3, "0")}`,
        product_id: entry.id,
        product_type_id: "cref_1",
      })
    )
    const { catalogService, container, productService } = containerFixture({
      products,
      profiles,
    })

    const report = await loadCatalogAuthoringAudit(container)

    expect(report.summary).toMatchObject({
      blockingItemCount: 0,
      total: 251,
    })
    expect(productService.listAndCountProducts).toHaveBeenCalledTimes(2)
    expect(productService.listAndCountProducts).toHaveBeenNthCalledWith(
      1,
      {},
      expect.objectContaining({ order: { id: "ASC" }, skip: 0, take: 250 })
    )
    expect(
      catalogService.listAndCountCatalogProductProfiles
    ).toHaveBeenCalledTimes(2)
  })

  it("rejects a short counted Product page instead of returning a partial audit", async () => {
    const { container, productService } = containerFixture({
      products: [product(1)],
    })
    productService.listAndCountProducts.mockResolvedValue([[product(1)], 2])

    await expect(loadCatalogAuthoringAudit(container)).rejects.toThrow(
      "authoring audit persistence boundary"
    )
  })

  it("rejects orphan profiles and bundles before classification", async () => {
    const { container } = containerFixture({
      bundles: [
        {
          bundle_type: "fixed",
          created_at: "2026-08-30T00:00:00.000Z",
          description_html: null,
          display_title: "Missing",
          fulfillment_mode: "ship_components",
          id: "cbundle_1",
          inventory_mode: "component_derived",
          is_active: true,
          metadata: {},
          product_id: "prod_missing",
          product_profile_id: null,
          updated_at: "2026-08-30T00:00:00.000Z",
          version: 1,
        },
      ],
      products: [product(1)],
    })

    await expect(loadCatalogAuthoringAudit(container)).rejects.toThrow(
      "authoring audit persistence boundary"
    )
  })
})
