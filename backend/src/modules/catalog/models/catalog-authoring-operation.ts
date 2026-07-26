import { model } from "@medusajs/framework/utils"

import { catalogAuthoringOperationStatuses } from "../constants"

const CatalogAuthoringOperation = model.define(
  {
    name: "catalog_authoring_operation",
    tableName: "catalog_authoring_operations",
  },
  {
    id: model.id({ prefix: "catop" }).primaryKey(),
    idempotency_key: model.text().unique(),
    command: model.text().index(),
    aggregate_id: model.text().index(),
    actor_id: model.text().nullable(),
    request_sha256: model.text(),
    expected_version: model.number(),
    status: model
      .enum([...catalogAuthoringOperationStatuses])
      .default("pending"),
    result: model.json().default({}),
    error_code: model.text().nullable(),
    error_detail: model.text().nullable(),
    completed_at: model.dateTime().nullable(),
    metadata: model.json().default({}),
  }
)

export default CatalogAuthoringOperation
