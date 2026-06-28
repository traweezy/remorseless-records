import { model } from "@medusajs/framework/utils"

import { catalogMediaDerivativeStatuses } from "../constants"

const CatalogMediaAsset = model.define(
  {
    name: "catalog_media_asset",
    tableName: "catalog_media_assets",
  },
  {
    id: model.id({ prefix: "cmedia" }).primaryKey(),
    source_url: model.text(),
    source_file_key: model.text().index().nullable(),
    original_filename: model.text().nullable(),
    mime_type: model.text().nullable(),
    byte_size: model.number().nullable(),
    width: model.number().nullable(),
    height: model.number().nullable(),
    alt_text: model.text().nullable(),
    caption: model.text().nullable(),
    focal_x: model.number().nullable(),
    focal_y: model.number().nullable(),
    crop_intent: model.text().nullable(),
    derivative_status: model
      .enum([...catalogMediaDerivativeStatuses])
      .default("source_only"),
    derivatives: model.json().default({}),
    metadata: model.json().default({}),
  }
)

export default CatalogMediaAsset
