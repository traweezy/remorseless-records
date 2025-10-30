import type { ProductSlug } from "@/lib/products/slug"

export type VariantOption = {
  id: string
  title: string
  currency: string
  amount: number
  inStock: boolean
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
}

export type ProductSearchHit = RelatedProductSummary & {
  genres: string[]
  categories: string[]
  categoryHandles: string[]
  variantTitles: string[]
  format?: string | null
  priceAmount?: number | null
  createdAt?: string | null
  stockStatus?: string | null
}
