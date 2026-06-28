import { Module } from "@medusajs/framework/utils"

import CatalogModuleService from "./service"

const catalogModule = Module("catalog", {
  service: CatalogModuleService,
})

export default catalogModule
