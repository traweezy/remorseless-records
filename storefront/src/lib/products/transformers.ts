import type { HttpTypes } from "@medusajs/types"

import {
  extractNonArtistCategoryFacets,
  extractProductCategoryGroups,
} from "@/lib/products/categories"
import { buildProductSlugParts } from "@/lib/products/slug"
import { resolveVariantStockStatus, summarizeStockStatus } from "@/lib/products/stock"
import { normalizeFormatValue } from "@/lib/search/normalize"
import type {
  ProductSearchHit,
  RelatedProductSummary,
  VariantOption,
} from "@/types/product"

const coerceRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const addCanonicalFormat = (set: Set<string>, value: string | null | undefined) => {
  const normalized = normalizeFormatValue(value)
  if (!normalized) {
    return
  }
  set.add(normalized)
}

const toVariantOption = (
  variant: HttpTypes.StoreProductVariant | undefined
): VariantOption | null => {
  if (!variant?.id) {
    return null
  }

  const price = variant.calculated_price

  const amountCandidates = [
    price?.calculated_amount,
    price?.calculated_amount_with_tax,
    price?.original_amount,
  ]
  const resolvedAmount = amountCandidates.find(
    (value) => typeof value === "number" && Number.isFinite(value)
  )
  const hasPrice = typeof resolvedAmount === "number"
  const amount = hasPrice ? resolvedAmount : 0

  const currency = price?.currency_code ?? "usd"

  const stockStatus =
    typeof (variant as { stock_status?: unknown }).stock_status === "string"
      ? ((variant as { stock_status?: string }).stock_status ?? "").toLowerCase()
      : null

  const inventoryQuantity = (() => {
    if (!("inventory_quantity" in variant)) {
      return null
    }
    const raw = (variant as { inventory_quantity?: number | null }).inventory_quantity
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null
  })()

  const manageInventory =
    "manage_inventory" in variant
      ? Boolean((variant as { manage_inventory?: boolean }).manage_inventory)
      : null

  const allowBackorder =
    "allow_backorder" in variant
      ? Boolean((variant as { allow_backorder?: boolean }).allow_backorder)
      : null

  const resolvedStock = resolveVariantStockStatus({
    inventoryQuantity,
    manageInventory,
    allowBackorder,
    stockStatus,
  })

  return {
    id: variant.id,
    title: variant.title ?? "Variant",
    currency,
    amount,
    hasPrice,
    inStock: resolvedStock.inStock,
    stockStatus: resolvedStock.status,
    inventoryQuantity,
  }
}

export const deriveVariantOptions = (
  variants: HttpTypes.StoreProductVariant[] | null | undefined
): VariantOption[] =>
  (variants ?? [])
    .map(toVariantOption)
    .filter((variant): variant is VariantOption => Boolean(variant))

export const mapStoreProductToRelatedSummary = (
  product: HttpTypes.StoreProduct
): RelatedProductSummary => {
  const variants = deriveVariantOptions(product.variants)
  const defaultVariant =
    variants.find((variant) => variant.inStock && variant.hasPrice) ??
    variants.find((variant) => variant.hasPrice) ??
    variants[0] ??
    null
  const slug = buildProductSlugParts(product)
  const handle =
    typeof product.handle === "string" && product.handle.trim().length
      ? product.handle.trim()
      : ""

  const formats = new Set<string>()

  variants.forEach((variant) => addCanonicalFormat(formats, variant.title))

  const formatOption = product.options?.find(
    (option) => option.title?.toLowerCase() === "format"
  )
  formatOption?.values?.forEach((value) => {
    const candidate = typeof value?.value === "string" ? value.value.trim() : ""
    addCanonicalFormat(formats, candidate)
  })

  const metadata = coerceRecord(product.metadata)
  if (metadata) {
    const metaCandidates = [
      typeof metadata.format === "string" ? metadata.format : null,
      typeof metadata.packaging === "string" ? metadata.packaging : null,
      ...(Array.isArray(metadata.formats)
        ? metadata.formats.filter((entry): entry is string => typeof entry === "string")
        : []),
    ]

    metaCandidates.forEach((entry) => addCanonicalFormat(formats, entry))
  }

  const categoryGroups = extractProductCategoryGroups(product.categories, {
    excludeHandles: [slug.artistSlug, slug.albumSlug],
  })
  categoryGroups.types.forEach((entry) => {
    if (entry.label.trim().length) {
      formats.add(entry.label.trim())
    }
  })

  const formatted = Array.from(formats)

  return {
    id: product.id,
    handle,
    title: product.title ?? "Untitled Release",
    artist: slug.artist,
    album: slug.album,
    slug,
    subtitle:
      typeof product.subtitle === "string" && product.subtitle.trim().length
        ? product.subtitle.trim()
        : slug.artist,
    thumbnail:
      product.thumbnail ??
      product.images?.[0]?.url ??
      null,
    collectionTitle: product.collection?.title ?? null,
    defaultVariant,
    formats: formatted,
    genres: categoryGroups.genres.map((entry) => entry.label),
  }
}

export const mapStoreProductToSearchHit = (
  product: HttpTypes.StoreProduct
): ProductSearchHit => {
  const summary = mapStoreProductToRelatedSummary(product)
  const variants = deriveVariantOptions(product.variants)
  const categoryGroups = extractProductCategoryGroups(product.categories, {
    excludeHandles: [summary.slug.artistSlug, summary.slug.albumSlug],
  })
  const categoryGenres = categoryGroups.genres.map((entry) => entry.label)
  const categoryTypes = categoryGroups.types.map((entry) => entry.label)
  const categoryFacets = extractNonArtistCategoryFacets(product.categories)
  const categoryHandles = categoryFacets.map((entry) => entry.handle)
  const categoryLabels = categoryFacets.map((entry) => entry.label)

  const variantTitles = Array.from(
    new Set(
      (product.variants ?? [])
        .map((variant) => (typeof variant?.title === "string" ? variant.title.trim() : ""))
        .filter((title): title is string => Boolean(title))
    )
  )

  const formatOption = product.options?.find(
    (option) => option.title?.toLowerCase() === "format"
  )
  const optionValue = formatOption?.values?.find(
    (value) => typeof value?.value === "string"
  )
  const formatValue =
    optionValue && typeof optionValue.value === "string"
      ? optionValue.value
      : undefined
  const derivedFormat = formatValue ?? summary.defaultVariant?.title ?? null

  const priceAmount = summary.defaultVariant?.hasPrice
    ? summary.defaultVariant.amount
    : null
  const createdAt =
    typeof product.created_at === "string"
      ? product.created_at
      : null
  const stockStatus = summarizeStockStatus(variants)

  const inferredFormats = new Set<string>()
  summary.formats.forEach((fmt) => addCanonicalFormat(inferredFormats, fmt))
  categoryTypes.forEach((label) => addCanonicalFormat(inferredFormats, label))
  addCanonicalFormat(inferredFormats, derivedFormat)
  variantTitles.forEach((title) => addCanonicalFormat(inferredFormats, title))

  const canonicalFormat = Array.from(inferredFormats)[0] ?? null

  const metadata = coerceRecord(product.metadata)
  const legacyImport = coerceRecord(metadata?.legacy_import)
  const productType =
    (typeof legacyImport?.product_type === "string" ? legacyImport.product_type : undefined) ??
    (typeof metadata?.product_type === "string" ? metadata.product_type : undefined) ??
    null

  return {
    ...summary,
    formats: Array.from(inferredFormats),
    genres:
      categoryGenres.length > 0
        ? categoryGenres
        : product.tags?.map((tag) => tag.value).filter((value): value is string => Boolean(value)) ??
          [],
    metalGenres: categoryGenres,
    categories: categoryLabels,
    categoryHandles,
    variantTitles,
    format: canonicalFormat,
    priceAmount,
    createdAt,
    stockStatus,
    productType,
  }
}
