import type {
  CatalogMediaAssetRecord,
  CatalogProductMediaItemRecord,
} from "../../../../modules/catalog/serializers"

import type CatalogModuleService from "../../../../modules/catalog/service"
import { loadProductMediaResponse } from "../../../../lib/catalog/product-media-read"

jest.mock("../../../../modules/catalog/serializers", () => ({
  catalogMediaDerivativeStatusValues: [
    "pending",
    "ready",
    "failed",
    "not_required",
  ],
  catalogMediaRoleValues: ["primary", "gallery", "detail", "variant"],
  serializeCatalogMediaAsset: (asset: CatalogMediaAssetRecord) => asset,
  serializeCatalogProductMediaItem: (
    item: CatalogProductMediaItemRecord,
    asset: CatalogMediaAssetRecord | null,
  ) => ({
    asset,
    id: item.id,
  }),
}))

type CatalogService = InstanceType<typeof CatalogModuleService>

const mediaItem = (
  id: string,
  mediaAssetId: string,
  sortOrder: number,
): CatalogProductMediaItemRecord => ({
  created_at: null,
  id,
  is_primary: sortOrder === 0,
  media_asset_id: mediaAssetId,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  role: sortOrder === 0 ? "primary" : "gallery",
  sort_order: sortOrder,
  updated_at: null,
  variant_id: null,
})

const mediaAsset = (id: string, sourceUrl: string): CatalogMediaAssetRecord => ({
  alt_text: null,
  byte_size: null,
  caption: null,
  content_sha256: null,
  created_at: null,
  crop_intent: null,
  derivative_status: "ready",
  derivatives: {},
  focal_x: null,
  focal_y: null,
  height: null,
  id,
  metadata: {},
  mime_type: "image/jpeg",
  original_filename: null,
  source_file_key: null,
  source_url: sourceUrl,
  updated_at: null,
  version: 1,
  width: null,
})

describe("loadProductMediaResponse", () => {
  it("loads all linked assets in one batch and preserves media order", async () => {
    const items = [
      mediaItem("media_1", "asset_1", 0),
      mediaItem("media_2", "asset_2", 1),
      mediaItem("media_3", "asset_missing", 2),
    ]
    const service = {
      listCatalogMediaAssets: jest.fn(async () => [
        mediaAsset("asset_2", "https://example.com/two.jpg"),
        mediaAsset("asset_1", "https://example.com/one.jpg"),
      ]),
      listCatalogProductMediaItems: jest.fn(async () => items),
    } as unknown as CatalogService

    const response = await loadProductMediaResponse(service, "prod_1")

    expect(service.listCatalogMediaAssets).toHaveBeenCalledWith(
      { id: ["asset_1", "asset_2", "asset_missing"] },
      {},
      undefined,
    )
    expect(response.media.map(({ id }) => id)).toEqual([
      "media_1",
      "media_2",
      "media_3",
    ])
    expect(response.media.map(({ asset }) => asset?.id ?? null)).toEqual([
      "asset_1",
      "asset_2",
      null,
    ])
  })

  it("does not issue an empty asset query", async () => {
    const service = {
      listCatalogMediaAssets: jest.fn(),
      listCatalogProductMediaItems: jest.fn(async () => []),
    } as unknown as CatalogService

    await expect(
      loadProductMediaResponse(service, "prod_empty"),
    ).resolves.toEqual({
      media: [],
      productId: "prod_empty",
    })
    expect(service.listCatalogMediaAssets).not.toHaveBeenCalled()
  })
})
