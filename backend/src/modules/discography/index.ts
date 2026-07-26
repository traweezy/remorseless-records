import { Module } from "@medusajs/framework/utils"

import DiscographyModuleService from "./service"

const discographyModule = Module("discography", {
  service: DiscographyModuleService,
})

export default discographyModule
