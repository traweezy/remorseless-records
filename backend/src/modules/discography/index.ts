import { Module } from "@medusajs/framework/utils"

import DiscographyModuleService from "./service"

const discographyModule: unknown = Module("discography", {
  service: DiscographyModuleService,
})

export default discographyModule
