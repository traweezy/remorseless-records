import { Module } from "@medusajs/framework/utils"

import DiscographyModuleService from "./service"

export default Module("discography", {
  service: DiscographyModuleService,
})
