import { model } from "@medusajs/framework/utils"

const DiscographyOperation = model.define(
  {
    name: "discography_operation",
    tableName: "discography_operations",
  },
  {
    id: model.id({ prefix: "discop" }).primaryKey(),
    idempotency_key: model.text().unique(),
    command: model.text().index(),
    aggregate_id: model.text().index(),
    actor_id: model.text().nullable(),
    request_sha256: model.text(),
    expected_version: model.number(),
    status: model.enum(["pending", "succeeded"]).default("pending"),
    result: model.json().default({}),
    completed_at: model.dateTime().nullable(),
    metadata: model.json().default({}),
  }
)

export default DiscographyOperation
