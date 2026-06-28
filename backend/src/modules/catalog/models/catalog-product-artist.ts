import { model } from "@medusajs/framework/utils"

const CatalogProductArtist = model.define(
  {
    name: "catalog_product_artist",
    tableName: "catalog_product_artists",
  },
  {
    id: model.id({ prefix: "cpart" }).primaryKey(),
    product_profile_id: model.text().index(),
    artist_id: model.text().index().nullable(),
    display_name: model.text().searchable(),
    role: model.text().default("primary"),
    sort_order: model.number().default(0),
    metadata: model.json().default({}),
  }
)

export default CatalogProductArtist
