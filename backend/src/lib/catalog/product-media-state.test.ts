import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"

import type { CatalogProductMediaSnapshot } from "./product-media-contract"
import {
  catalogMediaAssetState,
  rememberCatalogMediaAsset,
  restoreCatalogProductMediaSnapshot,
  snapshotCatalogProductMedia,
} from "./product-media-state"
import {
  readCatalogMediaAsset,
  type CatalogMediaAssetPersistenceRecord,
} from "./transaction-persistence-contracts"
import {
  catalogMediaAssetFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const context: Context<EntityManager> = {}
const asset = (index: number) =>
  readCatalogMediaAsset(
    catalogMediaAssetFixture({
      alt_text: `Previous cover ${index}`,
      id: `cmedia_${index}`,
      source_file_key: `covers/${index}.jpg`,
      source_url: `https://media.example/${index}.jpg`,
    })
  )

const snapshotFixture = (assetCount: number): CatalogProductMediaSnapshot => ({
  assets: Array.from({ length: assetCount }, (_, index) =>
    catalogMediaAssetState(asset(index))
  ),
  items: Array.from({ length: Math.min(assetCount, 100) }, (_, index) => ({
    id: `cpmedia_previous_${index}`,
    is_primary: index === 0,
    media_asset_id: `cmedia_${index}`,
    metadata: {},
    product_id: "prod_1",
    product_profile_id: "cprof_1",
    role: index === 0 ? "primary" : "gallery",
    sort_order: index,
    variant_id: null,
  })),
})

const serviceFixture = (
  existingAssets: CatalogMediaAssetPersistenceRecord[] = []
) => {
  const persistedAssets = new Map(
    existingAssets.map((record) => [record.id, record])
  )
  let currentItems = [catalogProductMediaItemFixture({ id: "cpmedia_current" })]
  const service = {
    createCatalogMediaAssets: jest.fn(
      async (payloads: CatalogProductMediaSnapshot["assets"]) =>
        payloads.map((payload) => {
          const record = readCatalogMediaAsset(
            catalogMediaAssetFixture(payload)
          )
          persistedAssets.set(record.id, record)
          return record
        })
    ),
    createCatalogProductMediaItems: jest.fn(
      async (payloads: CatalogProductMediaSnapshot["items"]) => {
        currentItems = payloads.map((payload) =>
          catalogProductMediaItemFixture(payload)
        )
        return currentItems
      }
    ),
    deleteCatalogProductMediaItems: jest.fn(async () => {
      currentItems = []
    }),
    listCatalogMediaAssets: jest.fn(async () => existingAssets),
    listCatalogProductMediaItems: jest.fn(async () => currentItems),
    updateCatalogMediaAssets: jest.fn(
      async (payloads: CatalogProductMediaSnapshot["assets"]) =>
        payloads.map((payload) => {
          const record = readCatalogMediaAsset({
            ...persistedAssets.get(payload.id),
            ...payload,
          })
          persistedAssets.set(record.id, record)
          return record
        })
    ),
  }
  return { persistedAssets, service }
}

const expectNoMutations = (
  service: ReturnType<typeof serviceFixture>["service"]
) => {
  expect(service.deleteCatalogProductMediaItems).not.toHaveBeenCalled()
  expect(service.createCatalogProductMediaItems).not.toHaveBeenCalled()
  expect(service.updateCatalogMediaAssets).not.toHaveBeenCalled()
  expect(service.createCatalogMediaAssets).not.toHaveBeenCalled()
}

describe("catalog media rollback snapshot bounds", () => {
  it("restores the full 100 previous plus 100 desired asset union", async () => {
    const previous = snapshotFixture(200)
    const existing = previous.assets.map((state, index) =>
      readCatalogMediaAsset(
        catalogMediaAssetFixture({
          ...state,
          alt_text: `Changed cover ${index}`,
          version: 2,
        })
      )
    )
    const { persistedAssets, service } = serviceFixture(existing)

    await restoreCatalogProductMediaSnapshot(
      service as never,
      "prod_1",
      previous,
      context
    )

    expect(service.listCatalogMediaAssets).toHaveBeenCalledWith(
      { id: previous.assets.map(({ id }) => id) },
      { take: 201 },
      context
    )
    expect(service.updateCatalogMediaAssets).toHaveBeenCalledTimes(200)
    expect(service.createCatalogMediaAssets).not.toHaveBeenCalled()
    expect([...persistedAssets.values()].map(catalogMediaAssetState)).toEqual(
      previous.assets
    )
    expect(service.createCatalogProductMediaItems).toHaveBeenCalledWith(
      previous.items,
      context
    )
    expect(service.listCatalogProductMediaItems).toHaveBeenLastCalledWith(
      { product_id: "prod_1" },
      { order: { id: "ASC", sort_order: "ASC" }, take: 101 },
      context
    )
  })

  it("recreates only missing owned assets within the 200-asset union", async () => {
    const previous = snapshotFixture(200)
    const { persistedAssets, service } = serviceFixture(
      Array.from({ length: 150 }, (_, index) => asset(index))
    )

    await restoreCatalogProductMediaSnapshot(
      service as never,
      "prod_1",
      previous,
      context
    )

    expect(service.updateCatalogMediaAssets).toHaveBeenCalledTimes(150)
    expect(service.createCatalogMediaAssets).toHaveBeenCalledTimes(50)
    expect([...persistedAssets.values()].map(catalogMediaAssetState)).toEqual(
      previous.assets
    )
  })

  it.each([
    ["more than 200 snapshot assets", () => snapshotFixture(201)],
    [
      "more than 100 snapshot links",
      () => {
        const previous = snapshotFixture(1)
        previous.items = Array.from({ length: 101 }, (_, index) => ({
          ...previous.items[0]!,
          id: `cpmedia_previous_${index}`,
          sort_order: index,
        }))
        return previous
      },
    ],
    [
      "duplicate snapshot asset IDs",
      () => {
        const previous = snapshotFixture(2)
        previous.assets[1] = { ...previous.assets[0]! }
        return previous
      },
    ],
  ] as const)("rejects %s before destructive changes", async (_name, input) => {
    const { service } = serviceFixture()

    await expect(
      restoreCatalogProductMediaSnapshot(
        service as never,
        "prod_1",
        input(),
        context
      )
    ).rejects.toThrow()

    expectNoMutations(service)
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
  })

  it.each([
    ["duplicate rows", [asset(0), asset(0)]],
    ["unexpected foreign ID", [asset(0), asset(999)]],
    [
      "more than 200 returned rows",
      Array.from({ length: 201 }, (_, index) => asset(index)),
    ],
  ] as const)(
    "rejects %s before deleting current links",
    async (_name, rows) => {
      const { service } = serviceFixture([...rows])

      await expect(
        restoreCatalogProductMediaSnapshot(
          service as never,
          "prod_1",
          snapshotFixture(200),
          context
        )
      ).rejects.toThrow()

      expectNoMutations(service)
    }
  )

  it("cannot remember a 201st distinct asset and preserves deduplication", () => {
    const previous = snapshotFixture(200)

    expect(() => rememberCatalogMediaAsset(previous, asset(199))).not.toThrow()
    expect(previous.assets).toHaveLength(200)
    expect(() => rememberCatalogMediaAsset(previous, asset(200))).toThrow()
    expect(previous.assets).toHaveLength(200)
  })

  it("retains the 100-link bound when taking the previous snapshot", async () => {
    const { service } = serviceFixture()
    service.listCatalogProductMediaItems.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) =>
        catalogProductMediaItemFixture({ id: `cpmedia_${index}` })
      )
    )

    await expect(
      snapshotCatalogProductMedia(service as never, "prod_1", context)
    ).rejects.toThrow()
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
    expectNoMutations(service)
  })
})
