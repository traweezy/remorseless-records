"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { ProductCatalogProfileWidget } from "../components/catalog-admin-widgets"

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductCatalogProfileWidget
