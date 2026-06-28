import { model } from "@medusajs/framework/utils"

const CatalogShelfProduct = model.define(
  {
    name: "catalog_shelf_product",
    tableName: "catalog_shelf_products",
  },
  {
    id: model.id({ prefix: "cshelfp" }).primaryKey(),
    shelf_id: model.text().index(),
    product_id: model.text().index(),
    product_profile_id: model.text().index().nullable(),
    sort_order: model.number().default(0),
    is_pinned: model.boolean().default(false),
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    metadata: model.json().default({}),
  }
)

export default CatalogShelfProduct
