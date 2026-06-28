import { model } from "@medusajs/framework/utils"

export const catalogReferenceKinds = [
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
] as const

const CatalogReferenceValue = model.define(
  {
    name: "catalog_reference_value",
    tableName: "catalog_reference_values",
  },
  {
    id: model.id({ prefix: "cref" }).primaryKey(),
    kind: model.enum([...catalogReferenceKinds]).index(),
    label: model.text().searchable(),
    value: model.text().searchable().index(),
    description: model.text().nullable(),
    rank: model.number().default(0),
    is_active: model.boolean().default(true),
    metadata: model.json().default({}),
  }
)

export default CatalogReferenceValue
