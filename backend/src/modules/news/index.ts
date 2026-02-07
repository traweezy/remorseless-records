import { Module } from "@medusajs/framework/utils"

import NewsModuleService from "./service"

const newsModule: unknown = Module("news", {
  service: NewsModuleService,
})

export default newsModule
