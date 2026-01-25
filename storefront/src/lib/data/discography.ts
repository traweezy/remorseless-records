import type { HttpTypes } from "@medusajs/types"
import { unstable_cache } from "next/cache"

import { storeClient } from "@/lib/medusa"
import { buildProductSlugParts, type ProductSlug } from "@/lib/products/slug"
import { mapStoreProductToRelatedSummary } from "@/lib/products/transformers"

export type DiscographyAvailability =
  | "in_print"
  | "out_of_print"
  | "preorder"
  | "digital_only"
  | "unknown"

export type DiscographyEntry = {
  id: string
  title: string
  artist: string
  album: string
  slug: ProductSlug
  productHandle: string | null
  productPath: string
  collectionTitle: string | null
  catalogNumber: string | null
  releaseDate: string | null
  releaseYear: number | null
  formats: string[]
  genres: string[]
  availability: DiscographyAvailability
  coverUrl: string | null
}

const DISCOGRAPHY_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "thumbnail",
  "metadata",
  "status",
  "created_at",
  "updated_at",
  "*collection",
  "*categories",
  "*categories.parent_category",
  "*variants",
  "variants.inventory_quantity",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "*options",
  "*images",
  "*tags",
].join(",")

const coerceRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const parseYear = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed.length) {
      return null
    }
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const parseDate = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const resolveAvailability = (
  product: HttpTypes.StoreProduct,
  inStock: boolean
): DiscographyAvailability => {
  const metadata = coerceRecord(product.metadata)
  const explicit =
    typeof metadata?.availability === "string"
      ? metadata.availability
      : typeof metadata?.status === "string"
        ? metadata.status
        : null

  const normalized = explicit?.toLowerCase().trim()
  if (normalized === "in_print" || normalized === "in-stock" || normalized === "available") {
    return "in_print"
  }
  if (normalized === "out_of_print" || normalized === "oos" || normalized === "sold_out") {
    return "out_of_print"
  }
  if (normalized === "preorder" || normalized === "pre-order") {
    return "preorder"
  }
  if (normalized === "digital_only" || normalized === "digital-only" || normalized === "digital") {
    return "digital_only"
  }

  if (metadata) {
    if (metadata.preorder === true) {
      return "preorder"
    }
    if (metadata.digital_only === true || metadata.digitalOnly === true) {
      return "digital_only"
    }
  }

  return inStock ? "in_print" : "out_of_print"
}

const parseReleaseDate = (
  product: HttpTypes.StoreProduct
): { releaseDate: string | null; releaseYear: number | null } => {
  const metadata = coerceRecord(product.metadata)

  const dateCandidate =
    parseDate(metadata?.release_date) ??
    parseDate(metadata?.releaseDate) ??
    parseDate(metadata?.street_date) ??
    parseDate(metadata?.streetDate)

  const yearCandidate =
    parseYear(metadata?.release_year) ??
    parseYear(metadata?.year) ??
    parseYear(metadata?.releaseYear) ??
    parseYear(metadata?.street_year) ??
    parseYear(metadata?.streetYear)

  const releaseDate = dateCandidate
  const releaseYear =
    yearCandidate ??
    (releaseDate ? new Date(releaseDate).getUTCFullYear() : null) ??
    (typeof product.created_at === "string"
      ? new Date(product.created_at).getUTCFullYear()
      : null)

  return { releaseDate, releaseYear }
}

const selectCatalogNumber = (product: HttpTypes.StoreProduct): string | null => {
  const metadata = coerceRecord(product.metadata)
  if (!metadata) {
    return null
  }

  const candidates = [
    metadata.catalog_number,
    metadata.catalogNumber,
    metadata.catno,
    metadata.cat_no,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate.trim()
    }
  }

  return null
}

const toDiscographyEntry = (product: HttpTypes.StoreProduct): DiscographyEntry | null => {
  if (!product?.id) {
    return null
  }

  const summary = mapStoreProductToRelatedSummary(product)
  const slug = buildProductSlugParts(product)
  const { releaseDate, releaseYear } = parseReleaseDate(product)

  const productHandle =
    typeof product.handle === "string" && product.handle.trim().length
      ? product.handle.trim()
      : null

  const productPath = `/products/${productHandle ?? `${slug.artistSlug}-${slug.albumSlug}`}`
  const availability = resolveAvailability(product, summary.defaultVariant?.inStock ?? false)
  const catalogNumber = selectCatalogNumber(product)

  return {
    id: product.id,
    title: summary.title,
    artist: summary.artist,
    album: summary.album,
    slug,
    productHandle,
    productPath,
    collectionTitle: summary.collectionTitle ?? null,
    catalogNumber: catalogNumber ?? null,
    releaseDate,
    releaseYear,
    formats: summary.formats ?? [],
    genres: summary.genres ?? [],
    availability,
    coverUrl: summary.thumbnail ?? null,
  }
}

const extractProducts = (response: unknown): HttpTypes.StoreProduct[] => {
  if (!response || typeof response !== "object") {
    return []
  }

  const products = (response as { products?: unknown }).products
  if (!Array.isArray(products)) {
    return []
  }

  return products.filter(
    (product): product is HttpTypes.StoreProduct =>
      typeof product === "object" && product !== null && typeof (product as { handle?: unknown }).handle === "string"
  )
}

export const getDiscographyEntries = unstable_cache(
  async (): Promise<DiscographyEntry[]> => {
    const entries: DiscographyEntry[] = []
    const seen = new Set<string>()
    const pageSize = 100
    let offset = 0

    try {
      for (;;) {
        const response = await storeClient.product.list({
          limit: pageSize,
          offset,
          order: "created_at",
          fields: DISCOGRAPHY_FIELDS,
        } satisfies HttpTypes.StoreProductListParams)

        const products = extractProducts(response)
        if (!products.length) {
          break
        }

        products.forEach((product) => {
          if (product.id && seen.has(product.id)) {
            return
          }
          const entry = toDiscographyEntry(product)
          if (entry) {
            if (seen.has(entry.id)) {
              return
            }
            seen.add(entry.id)
            entries.push(entry)
          }
        })

        if (products.length < pageSize) {
          break
        }

        offset += products.length
      }
    } catch (error) {
      console.error("[getDiscographyEntries] Failed to load discography", error)
    }

    return entries
  },
  ["discography-entries"],
  { revalidate: 900, tags: ["products"] }
)
