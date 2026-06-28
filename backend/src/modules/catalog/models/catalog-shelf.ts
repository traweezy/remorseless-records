import { model } from "@medusajs/framework/utils"

import { catalogShelfAutomationTypes, catalogShelfModes } from "../constants"

const CatalogShelf = model.define(
  {
    name: "catalog_shelf",
    tableName: "catalog_shelves",
  },
  {
    id: model.id({ prefix: "cshelf" }).primaryKey(),
    handle: model.text().searchable().index(),
    title: model.text().searchable(),
    description: model.text().nullable(),
    mode: model.enum([...catalogShelfModes]).default("manual"),
    automation_type: model.enum([...catalogShelfAutomationTypes]).default("none"),
    show_ribbon: model.boolean().default(false),
    ribbon_label: model.text().nullable(),
    ribbon_priority: model.number().default(100),
    product_limit: model.number().nullable(),
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    is_active: model.boolean().default(true),
    metadata: model.json().default({}),
  }
)

export default CatalogShelf
