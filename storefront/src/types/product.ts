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
  thumbnail?: string | null
  collectionTitle?: string | null
  defaultVariant: VariantOption | null
}

export type ProductSearchHit = RelatedProductSummary & {
  genres: string[]
  format?: string | null
}
