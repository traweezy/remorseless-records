"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { ProductCatalogSummaryWidget } from "../features/catalog-authoring/product-catalog-summary-widget"

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductCatalogSummaryWidget
