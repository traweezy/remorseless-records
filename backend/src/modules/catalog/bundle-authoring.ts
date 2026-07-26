export type JsonObject = Record<string, unknown>

export type CatalogBundleProfileState = {
  id: string
  product_id: string
  product_profile_id: string | null
  bundle_type: "fixed" | "mystery" | "deal" | "selectable"
  inventory_mode: "component_derived" | "manual"
  fulfillment_mode: "ship_components" | "manual"
  display_title: string | null
  description_html: string | null
  is_active: boolean
  version: number
  metadata: JsonObject
}

export type CatalogBundleComponentState = {
  id: string
  bundle_profile_id: string
  component_product_id: string
  component_variant_id: string | null
  component_inventory_item_id: string | null
  title: string | null
  variant_title: string | null
  sku: string | null
  quantity: number
  sort_order: number
  is_required: boolean
  metadata: JsonObject
}

export type CatalogBundleStateSnapshot = {
  profile: CatalogBundleProfileState | null
  components: CatalogBundleComponentState[]
}

export type CatalogBundleInventoryLinkState = {
  id?: string
  bundle_profile_id: string
  bundle_variant_id: string
  inventory_item_id: string
  required_quantity: number
  metadata: JsonObject
}

export type CatalogBundleMutationInput = {
  actorId: string | null
  aggregateId: string
  command: "catalog.bundle.delete" | "catalog.bundle.upsert"
  expectedVersion: number
  idempotencyKey: string
  requestSha256: string
  profile: Omit<CatalogBundleProfileState, "id" | "version"> | null
  components: Array<
    Omit<CatalogBundleComponentState, "id" | "bundle_profile_id"> & {
      id?: string
    }
  >
}

export type CatalogBundleMutationResult = {
  operationId: string
  previous: CatalogBundleStateSnapshot
  profileId: string | null
  replayed: boolean
  result: JsonObject
  version: number
}
