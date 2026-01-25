import { getProductByHandle } from "@/lib/data/products"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"
import type { ProductSearchResponse } from "@/lib/search/search"

const needsHydration = (hit: ProductSearchHit): boolean => {
  if (!hit.handle?.trim()) {
    return false
  }

  const missingFormats = !Array.isArray(hit.formats) || hit.formats.length === 0
  const missingVariant = !hit.defaultVariant
  const missingCollection =
    (hit.collectionTitle ?? "").toString().trim().length === 0
  const missingGenres =
    (!Array.isArray(hit.genres) || hit.genres.length === 0) &&
    (!Array.isArray(hit.metalGenres) || hit.metalGenres.length === 0)
  const missingStockStatus =
    !hit.stockStatus || hit.stockStatus === "unknown"
  const missingInventoryQuantity =
    hit.defaultVariant?.inventoryQuantity == null ||
    hit.defaultVariant?.stockStatus === "unknown"

  return (
    missingFormats ||
    missingVariant ||
    missingCollection ||
    missingGenres ||
    missingStockStatus ||
    missingInventoryQuantity
  )
}

const mergeHits = (original: ProductSearchHit, fallback: ProductSearchHit): ProductSearchHit => {
  const mergedFormats = original.formats.length ? original.formats : fallback.formats
  const mergedVariant = original.defaultVariant ?? fallback.defaultVariant
  const mergedCollection =
    original.collectionTitle && original.collectionTitle.trim().length
      ? original.collectionTitle
      : fallback.collectionTitle
  const mergedStockStatus =
    original.stockStatus && original.stockStatus !== "unknown"
      ? original.stockStatus
      : fallback.stockStatus ?? original.stockStatus ?? null

  return {
    ...fallback,
    ...original,
    defaultVariant: mergedVariant,
    collectionTitle: mergedCollection ?? null,
    formats: mergedFormats,
    genres: original.genres.length ? original.genres : fallback.genres,
    metalGenres: original.metalGenres.length ? original.metalGenres : fallback.metalGenres,
    categories: original.categories.length ? original.categories : fallback.categories,
    categoryHandles: original.categoryHandles.length ? original.categoryHandles : fallback.categoryHandles,
    variantTitles: original.variantTitles.length ? original.variantTitles : fallback.variantTitles,
    format: original.format ?? fallback.format ?? null,
    priceAmount: original.priceAmount ?? fallback.priceAmount ?? null,
    stockStatus: mergedStockStatus,
  }
}

export const enrichSearchResponse = async (
  response: ProductSearchResponse
): Promise<ProductSearchResponse> => {
  const handlesToHydrate = Array.from(
    new Set(
      response.hits
        .filter(needsHydration)
        .map((hit) => hit.handle?.trim().toLowerCase())
        .filter((handle): handle is string => Boolean(handle))
    )
  )

  if (!handlesToHydrate.length) {
    return response
  }

  const hydrationEntries = await Promise.all(
    handlesToHydrate.map(async (handle) => {
      const product = await getProductByHandle(handle)
      if (!product) {
        return null
      }
      return [handle, mapStoreProductToSearchHit(product)] as const
    })
  )

  const hydrationMap = new Map<string, ProductSearchHit>()
  hydrationEntries.forEach((entry) => {
    if (!entry) {
      return
    }
    hydrationMap.set(entry[0], entry[1])
  })

  if (!hydrationMap.size) {
    return response
  }

  const hits = response.hits.map((hit) => {
    const handleKey = hit.handle?.trim().toLowerCase()
    if (!handleKey) {
      return hit
    }

    const fallback = hydrationMap.get(handleKey)
    if (!fallback) {
      return hit
    }

    return mergeHits(hit, fallback)
  })

  return {
    ...response,
    hits,
  }
}
