import type { Knex } from "@mikro-orm/knex"

export type OrphanCatalogMediaQuery = {
  lifecycleStatus?: "active" | "quarantined"
  limit: number
  offset: number
}

export type OrphanCatalogMediaPage = {
  count: number
  rows: Record<string, unknown>[]
}

export const buildOrphanCatalogMediaQueries = (
  knex: Knex,
  input: OrphanCatalogMediaQuery,
): {
  countQuery: Knex.QueryBuilder
  rowsQuery: Knex.QueryBuilder
} => {
  const baseQuery = knex("catalog_media_assets as asset")
    .whereNull("asset.deleted_at")
    .whereNotExists(
      knex("catalog_product_media as media")
        .select(knex.raw("1"))
        .whereRaw("media.media_asset_id = asset.id")
        .whereNull("media.deleted_at"),
    )
  if (input.lifecycleStatus) {
    baseQuery.where("asset.lifecycle_status", input.lifecycleStatus)
  }

  return {
    countQuery: baseQuery.clone().count({ count: "asset.id" }),
    rowsQuery: baseQuery
      .clone()
      .select("asset.*")
      .orderBy("asset.created_at", "desc")
      .orderBy("asset.id", "desc")
      .limit(input.limit)
      .offset(input.offset),
  }
}
