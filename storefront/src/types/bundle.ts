export type BundleAvailabilityOption = {
  variantId: string
  title: string
  sku: string | null
  availableQuantity: number | null
  available: boolean
}

export type BundleVariantAvailability = {
  bundleVariantIds: string[]
  bundleVariantTitles: string[]
  selectionMode: "exact" | "any"
  available: boolean
  options: BundleAvailabilityOption[]
}

export type BundleCompositionItem = {
  id: string
  title: string
  quantity: number
  required: boolean
  product: {
    id: string | null
    handle: string | null
    title: string | null
  }
  availabilityByBundleVariant: BundleVariantAvailability[]
}

export type BundleComposition = {
  productId: string
  handle: string
  title: string
  type: string
  componentCount: number
  unavailableMappingCount: number
  hasUnavailableComponents: boolean
  components: BundleCompositionItem[]
}
