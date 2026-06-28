import { model } from "@medusajs/framework/utils"

import {
  catalogBundleFulfillmentModes,
  catalogBundleInventoryModes,
  catalogBundleTypes,
} from "../constants"

const CatalogBundleProfile = model.define(
  {
    name: "catalog_bundle_profile",
    tableName: "catalog_bundle_profiles",
  },
  {
    id: model.id({ prefix: "cbundle" }).primaryKey(),
    product_id: model.text().index(),
    product_profile_id: model.text().index().nullable(),
    bundle_type: model.enum([...catalogBundleTypes]).default("fixed"),
    inventory_mode: model
      .enum([...catalogBundleInventoryModes])
      .default("component_derived"),
    fulfillment_mode: model
      .enum([...catalogBundleFulfillmentModes])
      .default("ship_components"),
    display_title: model.text().nullable(),
    description_html: model.text().nullable(),
    is_active: model.boolean().default(true),
    metadata: model.json().default({}),
  }
)

export default CatalogBundleProfile
