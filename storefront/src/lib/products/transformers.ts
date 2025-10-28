import type { HttpTypes } from "@medusajs/types"

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

  return {
    id: product.id,
    handle: product.handle ?? product.id,
    title: product.title ?? "Untitled Release",
    artist: slug.artist,
    album: slug.album,
    slug,
    thumbnail:
      product.thumbnail ??
      product.images?.[0]?.url ??
      null,
    collectionTitle: product.collection?.title ?? null,
    defaultVariant: variants[0] ?? null,
  }
}

export const mapStoreProductToSearchHit = (
  product: HttpTypes.StoreProduct
): ProductSearchHit => {
  const summary = mapStoreProductToRelatedSummary(product)
  const genres =
    product.tags?.map((tag) => tag.value).filter((value): value is string => Boolean(value)) ??
    []

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

  return {
    ...summary,
    genres,
    format: derivedFormat ?? null,
    priceAmount,
    createdAt,
    stockStatus,
  }
}
