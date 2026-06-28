import { model } from "@medusajs/framework/utils"

import { catalogReferenceKinds } from "../constants"

const CatalogProductReference = model.define(
  {
    name: "catalog_product_reference",
    tableName: "catalog_product_references",
  },
  {
    id: model.id({ prefix: "cpref" }).primaryKey(),
    product_profile_id: model.text().index(),
    reference_value_id: model.text().index(),
    kind: model.enum([...catalogReferenceKinds]).index(),
    sort_order: model.number().default(0),
    metadata: model.json().default({}),
  }
)

export default CatalogProductReference
