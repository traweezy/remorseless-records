import { MedusaService } from "@medusajs/framework/utils"

import CatalogArtist from "./models/catalog-artist"
import CatalogBundleComponent from "./models/catalog-bundle-component"
import CatalogBundleProfile from "./models/catalog-bundle-profile"
import CatalogProductArtist from "./models/catalog-product-artist"
import CatalogProductProfile from "./models/catalog-product-profile"
import CatalogProductReference from "./models/catalog-product-reference"
import CatalogReferenceValue from "./models/catalog-reference-value"
import CatalogShelf from "./models/catalog-shelf"
import CatalogShelfProduct from "./models/catalog-shelf-product"
import CatalogVariantProfile from "./models/catalog-variant-profile"

class CatalogModuleService extends MedusaService({
  CatalogArtist,
  CatalogBundleProfile,
  CatalogBundleComponent,
  CatalogReferenceValue,
  CatalogProductProfile,
  CatalogProductArtist,
  CatalogProductReference,
  CatalogVariantProfile,
  CatalogShelf,
  CatalogShelfProduct,
}) {}

export default CatalogModuleService
