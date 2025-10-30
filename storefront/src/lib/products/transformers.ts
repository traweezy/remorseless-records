import type { HttpTypes } from "@medusajs/types"

import {
  extractNonArtistCategoryFacets,
  extractProductCategoryGroups,
} from "@/lib/products/categories"
import { buildProductSlugParts } from "@/lib/products/slug"
import type {
  ProductSearchHit,
  RelatedProductSummary,
  VariantOption,
} from "@/types/product"

const toVariantOption = (
  variant: HttpTypes.StoreProductVariant | undefined
): VariantOption | null => {
  if (!variant?.id) {
    return null
  }

  const price = variant.calculated_price

  const amount =
    Number(
      price?.calculated_amount ??
        price?.calculated_amount_with_tax ??
        price?.original_amount ??
        0
    ) || 0

  const currency = price?.currency_code ?? "usd"

  const stockStatus =
    typeof (variant as { stock_status?: unknown }).stock_status === "string"
      ? ((variant as { stock_status?: string }).stock_status ?? "").toLowerCase()
      : null

  const inventoryQuantity =
    "inventory_quantity" in variant
      ? Number(
          (variant as { inventory_quantity?: number }).inventory_quantity ?? 0
        )
      : undefined

  const inStock =
    stockStatus != null
      ? ["in_stock", "limited", "available"].includes(stockStatus)
      : inventoryQuantity !== undefined
        ? inventoryQuantity > 0
        : true

  return {
    id: variant.id,
    title: variant.title ?? "Variant",
    currency,
    amount,
    inStock,
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
  const slug = buildProductSlugParts(product)
  const handle =
    typeof product.handle === "string" && product.handle.trim().length
      ? product.handle.trim()
      : ""

  const formats = new Set<string>()

  variants.forEach((variant) => {
    if (variant.title.trim().length) {
      formats.add(variant.title.trim())
    }
  })

  const formatOption = product.options?.find((option) => option.title?.toLowerCase() === "format")
  formatOption?.values?.forEach((value) => {
    const candidate = typeof value?.value === "string" ? value.value.trim() : ""
    if (candidate.length) {
      formats.add(candidate)
    }
  })

  const metadata = product.metadata as Record<string, unknown> | null | undefined
  if (metadata) {
    const metaCandidates = [
      typeof metadata.format === "string" ? metadata.format : null,
      typeof metadata.packaging === "string" ? metadata.packaging : null,
      ...(Array.isArray(metadata.formats) ? metadata.formats : []),
    ]

    metaCandidates.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length) {
        formats.add(entry.trim())
      }
    })
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
    defaultVariant: variants[0] ?? null,
    formats: formatted,
  }
}

export const mapStoreProductToSearchHit = (
  product: HttpTypes.StoreProduct
): ProductSearchHit => {
  const summary = mapStoreProductToRelatedSummary(product)
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
  const derivedFormat =
    formatValue ??
    summary.defaultVariant?.title ??
    null

  const priceAmount = summary.defaultVariant?.amount ?? null
  const createdAt =
    typeof product.created_at === "string"
      ? product.created_at
      : null
  const stockStatus = summary.defaultVariant?.inStock ? "in_stock" : "sold_out"

  const inferredFormats = new Set<string>(summary.formats)
  categoryTypes.forEach((label) => {
    if (label.trim().length) {
      inferredFormats.add(label.trim())
    }
  })
  if (derivedFormat) {
    inferredFormats.add(derivedFormat)
  }

  return {
    ...summary,
    formats: Array.from(inferredFormats),
    genres:
      categoryGenres.length > 0
        ? categoryGenres
        : product.tags?.map((tag) => tag.value).filter((value): value is string => Boolean(value)) ??
          [],
    categories: categoryLabels,
    categoryHandles,
    variantTitles,
    format: categoryTypes[0] ?? derivedFormat ?? null,
    priceAmount,
    createdAt,
    stockStatus,
  }
}
