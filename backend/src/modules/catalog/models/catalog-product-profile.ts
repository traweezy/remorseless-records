import { model } from "@medusajs/framework/utils"

const CatalogProductProfile = model.define(
  {
    name: "catalog_product_profile",
    tableName: "catalog_product_profiles",
  },
  {
    id: model.id({ prefix: "cprof" }).primaryKey(),
    product_id: model.text().index(),
    release_title: model.text().searchable().nullable(),
    label_id: model.text().index().nullable(),
    product_type_id: model.text().index().nullable(),
    release_date: model.dateTime().nullable(),
    release_year: model.number().nullable(),
    description_html: model.text().nullable(),
    search_keywords: model.array().default([]),
    tracklist: model.json().default([] as unknown as Record<string, unknown>),
    credits: model.json().default({}),
    pressing_notes: model.json().default({}),
    merch_details: model.json().default({}),
    metadata: model.json().default({}),
  }
)

export default CatalogProductProfile
