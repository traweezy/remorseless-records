import type {
  CatalogMediaAssetRecord,
  CatalogProductMediaItemRecord,
} from "../../modules/catalog/serializers"

import type CatalogModuleService from "../../modules/catalog/service"
import { loadProductMediaResponse } from "./product-media-read"
import {
  catalogMediaAssetFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

jest.mock("../../modules/catalog/serializers", () => ({
  catalogMediaDerivativeStatusValues: [
    "source_only",
    "pending",
    "processing",
    "ready",
    "failed",
  ],
  catalogMediaLifecycleStatusValues: ["active", "quarantined"],
  catalogMediaRoleValues: [
    "primary",
    "gallery",
    "variant",
    "artist_photo",
    "news_cover",
    "open_graph",
  ],
  serializeCatalogMediaAsset: (asset: CatalogMediaAssetRecord) => asset,
  serializeCatalogProductMediaItem: (
    item: CatalogProductMediaItemRecord,
    asset: CatalogMediaAssetRecord | null
  ) => ({
    asset,
    id: item.id,
  }),
}))

type CatalogService = InstanceType<typeof CatalogModuleService>

const mediaItem = (
  id: string,
  mediaAssetId: string,
  sortOrder: number
): CatalogProductMediaItemRecord => ({
  ...catalogProductMediaItemFixture(),
  id,
  is_primary: sortOrder === 0,
  media_asset_id: mediaAssetId,
  role: sortOrder === 0 ? "primary" : "gallery",
  sort_order: sortOrder,
})

const mediaAsset = (
  id: string,
  sourceUrl: string
): CatalogMediaAssetRecord => ({
  ...catalogMediaAssetFixture({
    alt_text: null,
    byte_size: null,
    derivative_status: "ready",
    focal_x: null,
    focal_y: null,
    height: null,
    id,
    original_filename: null,
    source_file_key: null,
    source_url: sourceUrl,
    width: null,
  }),
})

describe("loadProductMediaResponse", () => {
  it("loads all linked assets in one batch and preserves media order", async () => {
    const items = [
      mediaItem("cpmedia_1", "cmedia_1", 0),
      mediaItem("cpmedia_2", "cmedia_2", 1),
    ]
    const service = {
      listCatalogMediaAssets: jest.fn(async () => [
        mediaAsset("cmedia_2", "https://example.com/two.jpg"),
        mediaAsset("cmedia_1", "https://example.com/one.jpg"),
      ]),
      listCatalogProductMediaItems: jest.fn(async () => items),
    } as unknown as CatalogService

    const response = await loadProductMediaResponse(service, "prod_1")

    expect(service.listCatalogMediaAssets).toHaveBeenCalledWith(
      { id: ["cmedia_1", "cmedia_2"] },
      { take: 101 },
      undefined
    )
    expect(response.media.map(({ id }) => id)).toEqual([
      "cpmedia_1",
      "cpmedia_2",
    ])
    expect(response.media.map(({ asset }) => asset?.id ?? null)).toEqual([
      "cmedia_1",
      "cmedia_2",
    ])
  })

  it("rejects a media link whose asset projection is missing", async () => {
    const service = {
      listCatalogMediaAssets: jest.fn(async () => []),
      listCatalogProductMediaItems: jest.fn(async () => [
        mediaItem("cpmedia_1", "cmedia_missing", 0),
      ]),
    } as unknown as CatalogService

    await expect(loadProductMediaResponse(service, "prod_1")).rejects.toThrow(
      "transaction persistence boundary"
    )
  })

  it("does not issue an empty asset query", async () => {
    const service = {
      listCatalogMediaAssets: jest.fn(),
      listCatalogProductMediaItems: jest.fn(async () => []),
    } as unknown as CatalogService

    await expect(
      loadProductMediaResponse(service, "prod_empty")
    ).resolves.toEqual({
      media: [],
      productId: "prod_empty",
    })
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
  })
})
