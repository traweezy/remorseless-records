import { normalizeFormatValue } from "@/lib/search/normalize"
import type { ProductSearchHit } from "@/types/product"

export type CatalogFilterOption = {
  value: string
  label: string
  count: number
}

export type CatalogFilterOptionsResponse = {
  options: CatalogFilterOption[]
}

export type CatalogPriceRange = {
  min: number
  max: number
  currency: string
}

export type CatalogPriceRangeResponse = {
  range: CatalogPriceRange
}

export type CatalogFilterDefinitions = {
  genres: CatalogFilterOption[]
  formats: CatalogFilterOption[]
  productTypes: CatalogFilterOption[]
  priceRange: CatalogPriceRange | null
}

export type CatalogGenreSeed = {
  handle: string
  label: string
  rank?: number
}

export type CatalogFilterFacetSource = {
  genres?: Record<string, number>
  productTypes?: Record<string, number>
}

export type CatalogFilterKind = "formats" | "genres" | "product-types"

export const buildCatalogPriceRange = (
  hits: ProductSearchHit[]
): CatalogPriceRange | null => {
  const amounts = hits.flatMap((hit) => {
    const low = hit.priceMin ?? hit.priceAmount ?? hit.defaultVariant?.amount
    const high = hit.priceMax ?? hit.priceAmount ?? hit.defaultVariant?.amount
    return [low, high].filter(
      (amount): amount is number =>
        typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    )
  })

  if (!amounts.length) {
    return null
  }

  const currency =
    hits.find((hit) => hit.defaultVariant?.currency)?.defaultVariant
      ?.currency ?? "usd"

  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    currency: currency.toLowerCase(),
  }
}

const FORMAT_ORDER = new Map([
  ["Vinyl", 0],
  ["CD", 1],
  ["Cassette", 2],
  ["DVD", 3],
])

const PRODUCT_TYPE_DEFINITIONS = [
  { values: ["music-release", "music_release"], label: "Music Releases" },
  { values: ["merch"], label: "Merchandise" },
  { values: ["fixed-bundle", "fixed_bundle"], label: "Fixed Bundles" },
  { values: ["mystery-bundle", "mystery_bundle"], label: "Mystery Bundles" },
] as const

const normalizeKey = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return normalized.length ? normalized : null
}

const slugifyFilterValue = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

export const formatProductTypeLabel = (value: string): string => {
  const normalized = normalizeKey(value) ?? ""
  const definition = PRODUCT_TYPE_DEFINITIONS.find(({ values }) =>
    values.some((candidate) => candidate === normalized)
  )
  return (
    definition?.label ??
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
  )
}

const canonicalProductType = (
  value: string | null | undefined
): string | null => {
  const normalized = normalizeKey(value)
  if (!normalized) {
    return null
  }
  const definition = PRODUCT_TYPE_DEFINITIONS.find(({ values }) =>
    values.some((candidate) => candidate === normalized)
  )
  return definition?.values[0] ?? normalized
}

const productFormats = (hit: ProductSearchHit): Set<string> => {
  const formats = new Set<string>()
  const add = (value: string | null | undefined) => {
    const normalized = normalizeFormatValue(value)
    if (normalized) {
      formats.add(normalized)
    }
  }

  add(hit.format)
  add(hit.defaultVariant?.title)
  hit.formats?.forEach(add)
  hit.variantTitles?.forEach(add)
  return formats
}

const buildFormatOptions = (
  hits: ProductSearchHit[]
): CatalogFilterOption[] => {
  const counts = new Map<string, number>()
  hits.forEach((hit) => {
    productFormats(hit).forEach((format) => {
      counts.set(format, (counts.get(format) ?? 0) + 1)
    })
  })

  return Array.from(counts, ([value, count]) => ({
    value,
    label: value,
    count,
  })).sort(
    (left, right) =>
      (FORMAT_ORDER.get(left.value) ?? Number.MAX_SAFE_INTEGER) -
        (FORMAT_ORDER.get(right.value) ?? Number.MAX_SAFE_INTEGER) ||
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  )
}

const buildGenreOptions = (
  hits: ProductSearchHit[],
  seeds: CatalogGenreSeed[],
  facetGenres?: Record<string, number>
): CatalogFilterOption[] => {
  const uniqueSeeds = new Map<
    string,
    { label: string; rank: number; insertionOrder: number }
  >()
  seeds.forEach((seed, insertionOrder) => {
    const handle = normalizeKey(seed.handle)
    const label = seed.label?.trim()
    if (!handle || !label || uniqueSeeds.has(handle)) {
      return
    }
    uniqueSeeds.set(handle, {
      label,
      rank: typeof seed.rank === "number" ? seed.rank : insertionOrder,
      insertionOrder,
    })
  })

  const facetEntries = Object.entries(facetGenres ?? {}).filter(
    ([label, count]) => label.trim().length > 0 && count > 0
  )
  if (facetEntries.length) {
    return facetEntries
      .map(([rawLabel, count], insertionOrder) => {
        const label = rawLabel.trim()
        const labelKey = normalizeKey(label)
        const slug = slugifyFilterValue(label)
        const seededEntry = Array.from(uniqueSeeds.entries()).find(
          ([handle, seed]) =>
            handle === slug || normalizeKey(seed.label) === labelKey
        )
        return {
          value: seededEntry?.[0] ?? slug,
          label: seededEntry?.[1].label ?? label,
          count,
          rank: seededEntry?.[1].rank ?? Number.MAX_SAFE_INTEGER,
          insertionOrder,
        }
      })
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.insertionOrder - right.insertionOrder ||
          left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
          })
      )
      .map(({ rank: _rank, insertionOrder: _order, ...option }) => option)
  }

  const counts = new Map<string, number>()
  hits.forEach((hit) => {
    const handles = new Set(
      (hit.categoryHandles ?? [])
        .map(normalizeKey)
        .filter((value): value is string => Boolean(value))
    )
    handles.forEach((handle) => {
      if (uniqueSeeds.has(handle)) {
        counts.set(handle, (counts.get(handle) ?? 0) + 1)
      }
    })
  })

  return Array.from(uniqueSeeds, ([value, seed]) => ({
    value,
    label: seed.label,
    count: counts.get(value) ?? 0,
    rank: seed.rank,
    insertionOrder: seed.insertionOrder,
  }))
    .filter(({ count }) => count > 0)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.insertionOrder - right.insertionOrder ||
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        })
    )
    .map(({ rank: _rank, insertionOrder: _order, ...option }) => option)
}

const buildProductTypeOptions = (
  hits: ProductSearchHit[],
  facetProductTypes?: Record<string, number>
): CatalogFilterOption[] => {
  const counts = new Map<string, number>()
  const facetEntries = Object.entries(facetProductTypes ?? {}).filter(
    ([rawType, count]) => rawType.trim().length > 0 && count > 0
  )
  if (facetEntries.length) {
    facetEntries.forEach(([rawType, count]) => {
      const productType = canonicalProductType(rawType)
      if (productType) {
        counts.set(productType, (counts.get(productType) ?? 0) + count)
      }
    })
  } else {
    hits.forEach((hit) => {
      const productType = canonicalProductType(hit.productType)
      if (productType) {
        counts.set(productType, (counts.get(productType) ?? 0) + 1)
      }
    })
  }

  const configured = PRODUCT_TYPE_DEFINITIONS.map((definition) => {
    const value = definition.values[0]
    return {
      value,
      label: definition.label,
      count: counts.get(value) ?? 0,
    }
  }).filter(({ count }) => count > 0)
  const configuredValues = new Set<string>(configured.map(({ value }) => value))
  const additional = Array.from(counts, ([value, count]) => ({
    value,
    label: formatProductTypeLabel(value),
    count,
  }))
    .filter(({ value }) => !configuredValues.has(value))
    .sort((left, right) => left.label.localeCompare(right.label))

  return [...configured, ...additional]
}

export const buildCatalogFilterDefinitions = (
  hits: ProductSearchHit[],
  genreSeeds: CatalogGenreSeed[],
  facets?: CatalogFilterFacetSource
): CatalogFilterDefinitions => ({
  genres: buildGenreOptions(hits, genreSeeds, facets?.genres),
  formats: buildFormatOptions(hits),
  productTypes: buildProductTypeOptions(hits, facets?.productTypes),
  priceRange: buildCatalogPriceRange(hits),
})
