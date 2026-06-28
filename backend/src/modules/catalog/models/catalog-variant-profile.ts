import { model } from "@medusajs/framework/utils"

export const catalogAvailabilityStatuses = [
  "available",
  "preorder",
  "backorder",
  "coming_soon",
  "sold_out",
] as const

const CatalogVariantProfile = model.define(
  {
    name: "catalog_variant_profile",
    tableName: "catalog_variant_profiles",
  },
  {
    id: model.id({ prefix: "cvprof" }).primaryKey(),
    variant_id: model.text().index(),
    product_profile_id: model.text().index().nullable(),
    format_id: model.text().index().nullable(),
    format_detail_id: model.text().index().nullable(),
    format_label: model.text().nullable(),
    format_detail_label: model.text().nullable(),
    display_label: model.text().nullable(),
    availability_status: model.enum([...catalogAvailabilityStatuses]).default("available"),
    preorder_release_date: model.dateTime().nullable(),
    backorder_allowed: model.boolean().default(false),
    backorder_note: model.text().nullable(),
    image_url: model.text().nullable(),
    metadata: model.json().default({}),
  }
)

export default CatalogVariantProfile
