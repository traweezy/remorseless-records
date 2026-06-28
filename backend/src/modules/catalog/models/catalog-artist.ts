import { model } from "@medusajs/framework/utils"

const CatalogArtist = model.define(
  {
    name: "catalog_artist",
    tableName: "catalog_artists",
  },
  {
    id: model.id({ prefix: "artist" }).primaryKey(),
    name: model.text().searchable(),
    slug: model.text().searchable().index(),
    sort_name: model.text().nullable(),
    image_url: model.text().nullable(),
    bio: model.text().nullable(),
    location: model.text().nullable(),
    metadata: model.json().default({}),
  }
)

export default CatalogArtist
