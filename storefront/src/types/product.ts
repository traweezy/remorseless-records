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
  format?: string | null
  priceAmount?: number | null
  createdAt?: string | null
  stockStatus?: StockStatus | null
  productType?: string | null
}
