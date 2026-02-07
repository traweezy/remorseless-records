import { MedusaService } from "@medusajs/framework/utils"

import NewsEntry from "./models/news-entry"

class NewsModuleService extends MedusaService({ NewsEntry }) {}

export default NewsModuleService
