import { model } from "@medusajs/framework/utils"

import {
  catalogMediaDerivativeStatuses,
  catalogMediaLifecycleStatuses,
} from "../constants"

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
    content_sha256: model.text().index().nullable(),
    alt_text: model.text().nullable(),
    caption: model.text().nullable(),
    focal_x: model.number().nullable(),
    focal_y: model.number().nullable(),
    crop_intent: model.text().nullable(),
    derivative_status: model
      .enum([...catalogMediaDerivativeStatuses])
      .default("source_only"),
    lifecycle_status: model
      .enum([...catalogMediaLifecycleStatuses])
      .default("active"),
    quarantined_at: model.dateTime().nullable(),
    quarantined_by: model.text().nullable(),
    purge_eligible_at: model.dateTime().nullable(),
    derivatives: model.json().default({}),
    version: model.number().default(1),
    metadata: model.json().default({}),
  }
)

export default CatalogMediaAsset
