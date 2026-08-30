import { model } from "@medusajs/framework/utils"

import { taxCollectionModes, taxProviderNames } from "../constants"

const TaxProviderControl = model.define(
  {
    name: "tax_provider_control",
    tableName: "tax_provider_controls",
  },
  {
    id: model.id({ prefix: "taxctrl" }).primaryKey(),
    active_provider: model.enum([...taxProviderNames]).default("taxrate_io"),
    collection_mode: model.enum([...taxCollectionModes]).default("collect"),
    generation: model.number().default(1),
    last_switched_by: model.text().nullable(),
    last_switch_reason: model.text().nullable(),
    metadata: model.json().default({}),
  }
)

export default TaxProviderControl
