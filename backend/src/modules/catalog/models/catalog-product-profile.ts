import { model } from "@medusajs/framework/utils"

import { catalogReleaseDatePrecisions } from "../constants"

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
    release_date_precision: model
      .enum([...catalogReleaseDatePrecisions])
      .default("unknown"),
    description_html: model.text().nullable(),
    search_keywords: model.array().default([]),
    // The pinned Medusa type patch accepts JSON arrays so this runtime default
    // remains a native Array; an Array subclass breaks graph projections.
    tracklist: model.json().default([]),
    credits: model.json().default({}),
    pressing_notes: model.json().default({}),
    merch_details: model.json().default({}),
    content_schema_version: model.number().default(1),
    version: model.number().default(1),
    metadata: model.json().default({}),
  }
)

export default CatalogProductProfile
