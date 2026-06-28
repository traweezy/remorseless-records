"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { VariantCatalogProfileWidget } from "../components/catalog-admin-widgets"

export const config = defineWidgetConfig({
  zone: "product_variant.details.after",
})

export default VariantCatalogProfileWidget
