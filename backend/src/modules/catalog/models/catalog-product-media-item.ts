import { model } from "@medusajs/framework/utils"

import { catalogMediaRoles } from "../constants"

const CatalogProductMediaItem = model.define(
  {
    name: "catalog_product_media_item",
    tableName: "catalog_product_media",
  },
  {
    id: model.id({ prefix: "cpmedia" }).primaryKey(),
    product_id: model.text().index(),
    variant_id: model.text().index().nullable(),
    product_profile_id: model.text().index().nullable(),
    media_asset_id: model.text().index(),
    role: model.enum([...catalogMediaRoles]).default("gallery"),
    sort_order: model.number().default(0),
    is_primary: model.boolean().default(false),
    metadata: model.json().default({}),
  }
)

export default CatalogProductMediaItem
