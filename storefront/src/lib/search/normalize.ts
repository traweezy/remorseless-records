import type { FacetDistribution } from "meilisearch"

import { humanizeCategoryHandle } from "@/lib/products/categories"
import { buildProductSlugParts } from "@/lib/products/slug"
import type { ProductSearchHit, VariantOption } from "@/types/product"

const asStringArray = (value: unknown): string[] => {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : null))
      .filter((entry): entry is string => Boolean(entry))
  }

  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean)
  }

  return []
}

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true
    if (value.toLowerCase() === "false") return false
  }

  return null
}

const toVariantOption = (
  variantId: string | null,
  amount: number | null,
  currency: string,
  format: string | null,
  inStock: boolean
): VariantOption | null => {
  if (!variantId || amount === null) {
    return null
  }

  return {
    id: variantId,
    title: format ?? "Variant",
    currency,
    amount,
    inStock,
  }
}

const coerceString = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString()
  }

  return null
}

const extractThumbnail = (hit: Record<string, unknown>): string | null => {
  if (typeof hit.thumbnail === "string") {
    return hit.thumbnail
  }

  if (typeof hit.image === "string") {
    return hit.image
  }

  const imagesValue = hit.images
  if (Array.isArray(imagesValue) && imagesValue.length > 0) {
    const first: unknown = imagesValue[0]
    if (typeof first === "string") {
      return first
    }
    if (
      first &&
      typeof first === "object" &&
      typeof (first as { url?: unknown }).url === "string"
    ) {
      return (first as { url: string }).url
    }
  }

  return null
}

export const normalizeSearchHit = (
  hit: Record<string, unknown>
): ProductSearchHit => {
  const id =
    coerceString(hit.id) ??
    coerceString(hit.product_id) ??
    coerceString(hit.uid) ??
    crypto.randomUUID()

  const handle =
    typeof hit.handle === "string" && hit.handle.trim().length
      ? hit.handle.trim()
      : ""

  const rawTitle =
    typeof hit.title === "string"
      ? hit.title
      : typeof hit.name === "string"
        ? hit.name
        : null

  const title = rawTitle ?? "Untitled Release"

  const subtitle =
    typeof hit.subtitle === "string"
      ? hit.subtitle
      : typeof hit.subTitle === "string"
        ? hit.subTitle
        : null

  const thumbnail =
    extractThumbnail(hit)

  const collectionTitle =
    typeof hit.collectionTitle === "string"
      ? hit.collectionTitle
      : typeof hit.collection_title === "string"
        ? hit.collection_title
        : typeof hit.collection === "string"
          ? hit.collection
          : null

  const metadataValue = coerceRecord(hit.metadata)

  const slug = buildProductSlugParts({
    title,
    metadata: metadataValue,
    collectionTitle,
  })

  const explicitArtist =
    typeof hit.artist === "string" && hit.artist.trim().length
      ? hit.artist.trim()
      : typeof metadataValue?.artist === "string" && metadataValue.artist.trim().length
        ? metadataValue.artist.trim()
        : null

  const formatCandidates = new Set<string>()

  const addFormat = (value: string | null | undefined) => {
    if (!value) {
      return
    }
    const trimmed = value.trim()
    if (!trimmed.length) {
      return
    }
    formatCandidates.add(trimmed)
  }

  const genres = asStringArray(hit.genres ?? hit.genre)
  const metalGenres = asStringArray(hit.metalGenres ?? hit.metal_genres)
  const categoryHandles = asStringArray(
    hit.category_handles ?? hit.categoryHandles ?? hit.categories
  )
  const categoryLabels =
    Array.isArray(hit.category_labels) && hit.category_labels.length
      ? asStringArray(hit.category_labels)
      : categoryHandles.map(humanizeCategoryHandle)

  const format =
    typeof hit.format === "string"
      ? hit.format
      : Array.isArray(hit.formats) && typeof hit.formats[0] === "string"
        ? hit.formats[0]
        : null

  categoryLabels.forEach(addFormat)
  categoryHandles.forEach(addFormat)

  const priceAmount =
    parseNumber(hit.price_amount ?? hit.price ?? hit.amount) ?? null
  const currency =
    typeof hit.price_currency === "string"
      ? hit.price_currency
      : typeof hit.currency === "string"
        ? hit.currency
        : typeof hit.currency_code === "string"
          ? hit.currency_code
          : "usd"

  const stockStatus =
    typeof hit.stock_status === "string"
      ? hit.stock_status.toLowerCase()
      : null

  const inStock =
    parseBoolean(hit.in_stock) ??
    (stockStatus ? ["in_stock", "available", "limited"].includes(stockStatus) : null) ??
    (parseNumber(hit.inventory_quantity ?? hit.quantity) ?? 0) > 0

  const variantId =
    typeof hit.default_variant_id === "string"
      ? hit.default_variant_id
      : typeof hit.variant_id === "string"
        ? hit.variant_id
        : typeof hit.variantId === "string"
          ? hit.variantId
          : null

  const variantTitles = asStringArray(
    hit.variant_titles ?? hit.variantTitles ?? hit.variants
  )

  variantTitles.forEach(addFormat)
  addFormat(format ?? undefined)

  const formats = Array.from(formatCandidates)

  const defaultVariant = toVariantOption(
    variantId,
    priceAmount,
    currency,
    format,
    Boolean(inStock)
  )

  const createdAt =
    typeof hit.created_at === "string"
      ? hit.created_at
      : typeof hit.createdAt === "string"
        ? hit.createdAt
        : null

  const productType =
    typeof hit.product_type === "string"
      ? hit.product_type
      : typeof hit.productType === "string"
        ? hit.productType
        : null

  return {
    id,
    handle,
    title,
    artist: explicitArtist ?? slug.artist ?? subtitle ?? title,
    album: slug.album,
    slug,
    subtitle,
    thumbnail,
    collectionTitle,
    defaultVariant,
    formats,
    genres,
    metalGenres,
    categories: categoryLabels,
    categoryHandles,
    variantTitles,
    format,
    priceAmount,
    createdAt,
    stockStatus,
    productType,
  }
}

export type FacetMap = Record<string, number>

const coerceFacetRecord = (
  value: FacetDistribution[string] | undefined
): FacetMap => {
  if (!value || typeof value !== "object") {
    return {}
  }

  return Object.entries(value).reduce<FacetMap>(
    (acc, [key, count]) => {
      const parsed = parseNumber(count)
      if (parsed !== null) {
        acc[key] = parsed
      }
      return acc
    },
    {}
  )
}

export const extractFacetMaps = (
  facetDistribution: FacetDistribution | undefined
): {
  genres: FacetMap
  metalGenres: FacetMap
  format: FacetMap
  categories: FacetMap
  variants: FacetMap
  productTypes: FacetMap
} => {
  if (!facetDistribution) {
    return {
      genres: {},
      metalGenres: {},
      format: {},
      categories: {},
      variants: {},
      productTypes: {},
    }
  }

  const genres = coerceFacetRecord(
    facetDistribution.genres ?? facetDistribution.genre
  )

  const metalGenres = coerceFacetRecord(
    facetDistribution.metalGenres ?? facetDistribution.metal_genres
  )

  const format = coerceFacetRecord(
    facetDistribution.format ?? facetDistribution.formats
  )

  const categories = coerceFacetRecord(
    facetDistribution.category_handles ?? facetDistribution.categories
  )

  const variants = coerceFacetRecord(
    facetDistribution.variant_titles ?? facetDistribution.variants
  )

  const productTypes = coerceFacetRecord(
    facetDistribution.product_type ?? facetDistribution.productTypes
  )

  return { genres, metalGenres, format, categories, variants, productTypes }
}
const coerceRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
