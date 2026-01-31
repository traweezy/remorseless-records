import { MedusaService } from "@medusajs/framework/utils"

import DiscographyEntry from "./models/discography-entry"

class DiscographyModuleService extends MedusaService({ DiscographyEntry }) {}

export default DiscographyModuleService
