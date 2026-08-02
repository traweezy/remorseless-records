import { model } from "@medusajs/framework/utils"

const DiscographyEntry = model.define(
  {
    name: "discography_entry",
    tableName: "discography_entries",
  },
  {
    id: model.id({ prefix: "disc" }).primaryKey(),
    title: model.text().searchable(),
    artist: model.text().searchable(),
    album: model.text().searchable(),
    product_id: model.text().index().nullable(),
    product_handle: model.text().index().nullable(),
    source_mode: model.enum(["catalog_product", "manual"]).default("manual"),
    collection_title: model.text().nullable(),
    catalog_number: model.text().nullable(),
    release_date: model.dateTime().nullable(),
    release_year: model.number().nullable(),
    formats: model.array().default([]),
    genres: model.array().default([]),
    tags: model.array().default([]),
    availability: model
      .enum(["in_print", "out_of_print", "preorder", "digital_only", "unknown"])
      .default("unknown"),
    cover_url: model.text().nullable(),
    cover_alt_text: model.text().nullable(),
    archived_at: model.dateTime().nullable(),
    version: model.number().default(1),
  }
)

export default DiscographyEntry
