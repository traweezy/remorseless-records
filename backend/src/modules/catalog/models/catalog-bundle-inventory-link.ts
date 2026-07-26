import { model } from "@medusajs/framework/utils"

const CatalogBundleInventoryLink = model.define(
  {
    name: "catalog_bundle_inventory_link",
    tableName: "catalog_bundle_inventory_links",
  },
  {
    id: model.id({ prefix: "cbilink" }).primaryKey(),
    bundle_profile_id: model.text().index(),
    bundle_variant_id: model.text().index(),
    inventory_item_id: model.text().index(),
    required_quantity: model.number(),
    metadata: model.json().default({}),
  }
)

export default CatalogBundleInventoryLink
