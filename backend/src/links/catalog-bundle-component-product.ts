import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"

import CatalogModule from "../modules/catalog"

export default defineLink(
  {
    linkable: CatalogModule.linkable.catalogBundleComponent,
    field: "component_product_id",
  },
  ProductModule.linkable.product,
  {
    readOnly: true,
  }
)
