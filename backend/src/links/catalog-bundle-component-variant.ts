import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"

import CatalogModule from "../modules/catalog"

export default defineLink(
  {
    linkable: CatalogModule.linkable.catalogBundleComponent,
    field: "component_variant_id",
  },
  ProductModule.linkable.productVariant,
  {
    readOnly: true,
  }
)
