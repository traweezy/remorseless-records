export const catalogReferenceKinds = [
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
] as const

export const catalogAvailabilityStatuses = [
  "available",
  "in_stock",
  "low_stock",
  "preorder",
  "backorder",
  "coming_soon",
  "sold_out",
  "unknown",
] as const

export const catalogBundleTypes = [
  "fixed",
  "mystery",
  "deal",
  "selectable",
] as const

export const catalogBundleInventoryModes = [
  "component_derived",
  "manual",
] as const

export const catalogBundleFulfillmentModes = [
  "ship_components",
  "manual",
] as const

export const catalogShelfModes = ["manual", "automatic", "hybrid"] as const

export const catalogShelfAutomationTypes = ["none", "new_release"] as const

export const catalogMediaRoles = [
  "gallery",
  "primary",
  "variant",
  "artist_photo",
  "news_cover",
  "open_graph",
] as const

export const catalogMediaDerivativeStatuses = [
  "source_only",
  "pending",
  "processing",
  "ready",
  "failed",
] as const
