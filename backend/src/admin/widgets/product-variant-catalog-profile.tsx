"use client"

import { defineWidgetConfig } from "@medusajs/admin-sdk"

import { VariantCatalogProfileWidget } from "../features/catalog-authoring/variant-catalog-profile-widget"

export const config = defineWidgetConfig({
  zone: "product_variant.details.after",
})

export default VariantCatalogProfileWidget
