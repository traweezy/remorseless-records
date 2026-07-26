import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"

import CatalogModule from "../modules/catalog"

export default defineLink(
  {
    linkable: CatalogModule.linkable.catalogProductMediaItem,
    field: "variant_id",
  },
  ProductModule.linkable.productVariant,
  {
    readOnly: true,
  }
)
