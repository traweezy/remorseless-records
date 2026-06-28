import { model } from "@medusajs/framework/utils"

const CatalogBundleComponent = model.define(
  {
    name: "catalog_bundle_component",
    tableName: "catalog_bundle_components",
  },
  {
    id: model.id({ prefix: "cbcomp" }).primaryKey(),
    bundle_profile_id: model.text().index(),
    component_product_id: model.text().index(),
    component_variant_id: model.text().index().nullable(),
    component_inventory_item_id: model.text().index().nullable(),
    title: model.text().nullable(),
    variant_title: model.text().nullable(),
    sku: model.text().nullable(),
    quantity: model.number().default(1),
    sort_order: model.number().default(0),
    is_required: model.boolean().default(true),
    metadata: model.json().default({}),
  }
)

export default CatalogBundleComponent
