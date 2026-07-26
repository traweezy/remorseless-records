import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"

import DiscographyModule from "../modules/discography"

export default defineLink(
  {
    linkable: DiscographyModule.linkable.discographyEntry,
    field: "product_id",
  },
  ProductModule.linkable.product,
  {
    readOnly: true,
  }
)
