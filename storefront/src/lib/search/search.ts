import type { FacetMap } from "@/lib/search/normalize"
import { extractFacetMaps, normalizeSearchHit } from "@/lib/search/normalize"
import type { ProductSearchHit } from "@/types/product"
import type { Filter, Index, MeiliSearch, SearchResponse } from "meilisearch"

export const PRODUCTS_INDEX = "products"

export type ProductSearchFilters = {
  genres?: string[]
  formats?: string[]
  categories?: string[]
  variants?: string[]
  productTypes?: string[]
}

export type ProductSortOption =
  | "title-asc"
  | "title-desc"
  | "newest"
  | "price-low"
  | "price-high"

export type ProductSearchRequest = {
  query: string
  limit?: number
  offset?: number
  filters?: ProductSearchFilters
  sort?: ProductSortOption
  inStockOnly?: boolean
}

export type ProductSearchResponse = {
  hits: ProductSearchHit[]
  total: number
  facets: {
    genres: FacetMap
    metalGenres: FacetMap
    format: FacetMap
    categories: FacetMap
    variants: FacetMap
    productTypes: FacetMap
  }
  offset: number
  hasMore?: boolean
  nextOffset?: number
}

type FilterDescriptor = {
  attribute:
    | "genres"
    | "metalGenres"
    | "format"
    | "category_handles"
    | "variant_titles"
    | "product_type"
    | "stock_status"
  values?: string[]
}

const normalizeValues = (values: string[] | undefined): string[] =>
  (values ?? []).map((value) => value.trim()).filter(Boolean)

const lowercaseSet = (values: string[]): Set<string> =>
  new Set(values.map((value) => value.toLowerCase()))

const buildFilter = (
  filters: ProductSearchFilters | undefined,
  inStockOnly: boolean | undefined,
  filterable: Set<string>
): {
  filterExpression: Filter | undefined
  postFilters: FilterDescriptor[]
} => {
  const clauses: string[] = []
  const postFilters: FilterDescriptor[] = []

  const tryFilter = (
    attribute: FilterDescriptor["attribute"],
    values?: string[]
  ) => {
    const normalized = normalizeValues(values)
    if (!normalized.length) {
      return
    }

    if (filterable.has(attribute)) {
      const escaped = normalized
        .map((value) => `"${value.replace(/"/g, '\\"')}"`)
        .join(", ")
      clauses.push(`${attribute} IN [${escaped}]`)
    } else {
      postFilters.push({ attribute, values: normalized })
    }
  }

  tryFilter("genres", filters?.genres)
  tryFilter("format", filters?.formats)
  postFilters.push({
    attribute: "category_handles",
    values: normalizeValues(filters?.categories),
  })
  tryFilter("variant_titles", filters?.variants)
  tryFilter("product_type", filters?.productTypes)

  if (inStockOnly) {
    clauses.push('(stock_status != "sold_out")')
  }

  const filterExpression = clauses.length ? (clauses.join(" AND ") as Filter) : undefined

  return { filterExpression, postFilters }
}

const filterHitsClient = (
  hits: ProductSearchHit[],
  descriptors: FilterDescriptor[]
): ProductSearchHit[] => {
  if (!descriptors.length) {
    return hits
  }

  return hits.filter((hit) => {
    for (const descriptor of descriptors) {
      const values = normalizeValues(descriptor.values)
      if (!values.length) {
        continue
      }

      const target = lowercaseSet(values)

      if (descriptor.attribute === "genres") {
        const genres = (hit.genres ?? []).map((value) => value.toLowerCase())
        if (!genres.some((value) => target.has(value))) {
          return false
        }
      } else if (descriptor.attribute === "format") {
        const format = hit.format?.toLowerCase() ?? ""
        if (!target.has(format)) {
          return false
        }
      } else if (descriptor.attribute === "category_handles") {
        const handles = (hit.categoryHandles ?? []).map((value) => value.toLowerCase())
        const handleSet = new Set(handles)
        if (!values.every((value) => handleSet.has(value.toLowerCase()))) {
          return false
        }
      } else if (descriptor.attribute === "variant_titles") {
        const variants = (hit.variantTitles ?? []).map((value) => value.toLowerCase())
        if (!variants.some((value) => target.has(value))) {
          return false
        }
      } else if (descriptor.attribute === "stock_status") {
        const status = hit.stockStatus?.toLowerCase() ?? ""
        if (!target.has(status)) {
          return false
        }
      }
    }
    return true
  })
}

export const computeFacetCounts = (
  hits: ProductSearchHit[]
): {
  genres: FacetMap
  metalGenres: FacetMap
  format: FacetMap
  categories: FacetMap
  variants: FacetMap
  productTypes: FacetMap
} => {
  const genres: FacetMap = {}
  const metalGenres: FacetMap = {}
  const format: FacetMap = {}
  const categories: FacetMap = {}
  const variants: FacetMap = {}
  const productTypes: FacetMap = {}

  hits.forEach((hit) => {
    hit.genres?.forEach((genre) => {
      if (!genre) {
        return
      }
      const key = genre.trim()
      if (key.length) {
        genres[key] = (genres[key] ?? 0) + 1
      }
    })

    if (hit.format) {
      const key = hit.format.trim()
      if (key.length) {
        format[key] = (format[key] ?? 0) + 1
      }
    }

    hit.categoryHandles?.forEach((handle) => {
      if (!handle) {
        return
      }
      const key = handle.trim()
      if (key.length) {
        categories[key] = (categories[key] ?? 0) + 1
      }
    })

    hit.metalGenres?.forEach((metal) => {
      if (!metal) {
        return
      }
      const key = metal.trim()
      if (key.length) {
        metalGenres[key] = (metalGenres[key] ?? 0) + 1
      }
    })

    hit.variantTitles?.forEach((variant) => {
      if (!variant) {
        return
      }
      const key = variant.trim()
      if (key.length) {
        variants[key] = (variants[key] ?? 0) + 1
      }
    })

    const typeKey = hit.productType?.trim()
    if (typeKey) {
      productTypes[typeKey] = (productTypes[typeKey] ?? 0) + 1
    }
  })

  return { genres, metalGenres, format, categories, variants, productTypes }
}

const filterableCache = new Map<string, Set<string>>()

const ensureFilterableAttributes = async (
  index: Index<Record<string, unknown>>
): Promise<Set<string>> => {
  const cacheKey = index.uid
  const cached = filterableCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const settings = await index.getSettings()
  const rawAttributes = settings.filterableAttributes ?? []
  const normalized = rawAttributes
    .map((value) => {
      if (typeof value === "string") {
        return value
      }
      if (value && typeof value === "object" && "attribute" in value) {
        const attribute = (value as { attribute?: string }).attribute
        return typeof attribute === "string" ? attribute : null
      }
      return null
    })
    .filter((value): value is string => Boolean(value))
  const filterable = new Set<string>(normalized)
  filterableCache.set(cacheKey, filterable)
  return filterable
}

export const searchProductsWithClient = async (
  client: MeiliSearch,
  { query, limit = 24, offset = 0, filters, sort, inStockOnly }: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const index = client.index(PRODUCTS_INDEX)
  const filterable = await ensureFilterableAttributes(index)
  const { filterExpression, postFilters } = buildFilter(filters, inStockOnly, filterable)

  const sortMapping: Record<ProductSortOption, string | null> = {
    "title-asc": "title:asc",
    "title-desc": "title:desc",
    newest: "created_at:desc",
    "price-low": "price_amount:asc",
    "price-high": "price_amount:desc",
  }

  const sortDirective = sort ? sortMapping[sort] ?? null : null
  const sortDirectives = sortDirective ? [sortDirective] : undefined

  const facetsToRequest: string[] = ["genres", "metalGenres", "format", "product_type"]
  if (filterable.has("category_handles")) {
    facetsToRequest.push("category_handles")
  }
  if (filterable.has("variant_titles")) {
    facetsToRequest.push("variant_titles")
  }

  const batchSize = Math.max(limit, 64)
  const filteredOffset = Math.max(0, offset ?? 0)
  let skipFiltered = filteredOffset
  let remainingToCollect = limit
  let totalFiltered = 0
  let collected: ProductSearchHit[] = []
  let hasMore = false
  let rawOffset = 0
  let facetDistribution: SearchResponse<Record<string, unknown>>["facetDistribution"]
  const maxBatches = 40

  for (let batch = 0; batch < maxBatches; batch++) {
    const response: SearchResponse<Record<string, unknown>> =
      await index.search<Record<string, unknown>>(query ?? "", {
        limit: batchSize,
        offset: rawOffset,
        facets: facetsToRequest,
        ...(filterExpression ? { filter: filterExpression } : {}),
        ...(sortDirectives ? { sort: sortDirectives } : {}),
      })

    if (!response.hits.length) {
      break
    }

    facetDistribution ??= response.facetDistribution

    let hits = response.hits
      .map((hit) => normalizeSearchHit(hit))
      .filter((hit) => hit.handle.trim().length > 0)

    if (postFilters.length) {
      hits = filterHitsClient(hits, postFilters)
    }

    totalFiltered += hits.length

    if (skipFiltered >= hits.length) {
      skipFiltered -= hits.length
    } else {
      const sliceStart = skipFiltered
      const usableHits = hits.slice(sliceStart)
      skipFiltered = 0

      if (usableHits.length > remainingToCollect) {
        hasMore = true
      }

      if (remainingToCollect > 0) {
        const taken = usableHits.slice(0, remainingToCollect)
        collected = collected.concat(taken)
        remainingToCollect -= taken.length
      }
    }

    rawOffset += response.hits.length

    if (response.hits.length < batchSize) {
      break
    }
  }

  hasMore = hasMore || totalFiltered > filteredOffset + collected.length

  const facetsFromIndex = extractFacetMaps(facetDistribution)
  const fallbackFacets = computeFacetCounts(collected)

  const facets = {
    genres: Object.keys(facetsFromIndex.genres).length
      ? facetsFromIndex.genres
      : fallbackFacets.genres,
    metalGenres: Object.keys(facetsFromIndex.metalGenres).length
      ? facetsFromIndex.metalGenres
      : fallbackFacets.metalGenres,
    format: Object.keys(facetsFromIndex.format).length
      ? facetsFromIndex.format
      : fallbackFacets.format,
    categories:
      filterable.has("category_handles") && Object.keys(facetsFromIndex.categories).length
        ? facetsFromIndex.categories
        : fallbackFacets.categories,
    variants:
      filterable.has("variant_titles") && Object.keys(facetsFromIndex.variants).length
        ? facetsFromIndex.variants
        : fallbackFacets.variants,
    productTypes: Object.keys(facetsFromIndex.productTypes).length
      ? facetsFromIndex.productTypes
      : fallbackFacets.productTypes,
  }

  return {
    hits: collected,
    total: totalFiltered,
    offset: filteredOffset,
    facets,
    hasMore,
    nextOffset: filteredOffset + collected.length,
  }
}
