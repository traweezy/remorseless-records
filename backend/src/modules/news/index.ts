import { Module } from "@medusajs/framework/utils"

import NewsModuleService from "./service"

export default Module("news", {
  service: NewsModuleService,
})
