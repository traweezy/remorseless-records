"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { CatalogProductListGuideWidget } from "../features/catalog-authoring/catalog-product-list-guide-widget"

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default CatalogProductListGuideWidget
