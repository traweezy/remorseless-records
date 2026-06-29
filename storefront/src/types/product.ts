import type { ProductSlug } from "@/lib/products/slug"

export type StockStatus = "in_stock" | "low_stock" | "sold_out" | "unknown"

export type VariantOption = {
  id: string
  title: string
  currency: string
  amount: number
  hasPrice: boolean
  inStock: boolean
  stockStatus: StockStatus
  inventoryQuantity: number | null
}

export type RelatedProductSummary = {
  id: string
  handle: string
  title: string
  artist: string
  album: string
  slug: ProductSlug
  subtitle: string | null
  thumbnail?: string | null
  collectionTitle?: string | null
  defaultVariant: VariantOption | null
  formats: string[]
  genres: string[]
}

export type ProductSearchHit = RelatedProductSummary & {
  genres: string[]
  metalGenres: string[]
  categories: string[]
  categoryHandles: string[]
  variantTitles: string[]
  artistNames?: string[]
  label?: string | null
  utilityTags?: string[]
  searchKeywords?: string[]
  format?: string | null
  formatDetails?: string[]
  priceAmount?: number | null
  priceMin?: number | null
  priceMax?: number | null
  createdAt?: string | null
  releaseDate?: string | null
  releaseYear?: number | null
  stockStatus?: StockStatus | null
  stockStatuses?: StockStatus[]
  availabilityStates?: string[]
  preorderAllowed?: boolean
  backorderAllowed?: boolean
  productType?: string | null
  productTypeLabel?: string | null
  bundleType?: string | null
  bundleSummary?: string | null
  ribbonLabel?: string | null
  ribbonPriority?: number | null
}
