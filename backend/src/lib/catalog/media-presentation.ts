import type {
  CatalogMediaAssetPersistenceRecord,
  CatalogProductMediaItemPersistenceRecord,
} from "./transaction-persistence-contracts"

export const compareCatalogMediaItems = (
  left: CatalogProductMediaItemPersistenceRecord,
  right: CatalogProductMediaItemPersistenceRecord
): number =>
  Number(right.is_primary) - Number(left.is_primary) ||
  left.sort_order - right.sort_order ||
  left.id.localeCompare(right.id)

export const selectActiveCatalogMedia = (
  items: readonly CatalogProductMediaItemPersistenceRecord[],
  assets: readonly CatalogMediaAssetPersistenceRecord[]
) => {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  return [...items].sort(compareCatalogMediaItems).flatMap((item) => {
    const asset = assetsById.get(item.media_asset_id)
    return asset?.lifecycle_status === "active" ? [{ item, asset }] : []
  })
}
