import type { FacetMap } from "@/lib/search/normalize"
import {
  extractFacetMaps,
  normalizeFormatValue,
  normalizeSearchHit,
} from "@/lib/search/normalize"
import type { ProductSearchHit } from "@/types/product"
import type { Filter, Index, MeiliSearch, SearchResponse } from "meilisearch"

export const PRODUCTS_INDEX = "products"
export const CATALOG_PAGE_SIZE = 60
export const CATALOG_SEARCH_ATTRIBUTES = [
  "title",
  "release_title",
  "artist_names",
  "artist",
] as const

export type ProductSearchFilters = {
  genres?: string[]
  formats?: string[]
  categories?: string[]
  variants?: string[]
  productTypes?: string[]
  availability?: string[]
  price?: {
    min?: number
    max?: number
  }
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
    availabilityStates: FacetMap
    stockStatuses: FacetMap
    bundleTypes: FacetMap
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
    | "formats"
    | "category_handles"
    | "variant_titles"
    | "product_type"
    | "status"
    | "stock_status"
    | "availability_states"
    | "price_range"
  values?: string[]
  price?: {
    min?: number
    max?: number
  }
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

  if (filterable.has("status")) {
    clauses.push('status = "published"')
  } else {
    postFilters.push({ attribute: "status", values: ["published"] })
  }

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
  const formatValues = normalizeValues(filters?.formats)
  if (formatValues.length) {
    const escaped = formatValues
      .map((value) => `"${value.replace(/"/g, '\\"')}"`)
      .join(", ")
    const formatAttributes = ["formats", "format", "variant_titles"].filter(
      (attribute) => filterable.has(attribute)
    )
    if (formatAttributes.length) {
      clauses.push(
        `(${formatAttributes
          .map((attribute) => `${attribute} IN [${escaped}]`)
          .join(" OR ")})`
      )
    } else {
      postFilters.push({ attribute: "formats", values: formatValues })
    }
  }
  const categoryValues = normalizeValues(filters?.categories)
  if (categoryValues.length) {
    if (filterable.has("category_handles")) {
      const escaped = categoryValues
        .map((value) => `"${value.replace(/"/g, '\\"')}"`)
        .join(", ")
      clauses.push(`category_handles IN [${escaped}]`)
    } else {
      postFilters.push({
        attribute: "category_handles",
        values: categoryValues,
      })
    }
  }
  tryFilter("variant_titles", filters?.variants)
  tryFilter("product_type", filters?.productTypes)
  tryFilter("availability_states", filters?.availability)

  const minPrice =
    typeof filters?.price?.min === "number" &&
    Number.isFinite(filters.price.min)
      ? filters.price.min
      : undefined
  const maxPrice =
    typeof filters?.price?.max === "number" &&
    Number.isFinite(filters.price.max)
      ? filters.price.max
      : undefined
  const canFilterPrice =
    filterable.has("price_min") && filterable.has("price_max")

  if (minPrice !== undefined || maxPrice !== undefined) {
    if (canFilterPrice) {
      if (minPrice !== undefined) {
        clauses.push(`price_max >= ${minPrice}`)
      }
      if (maxPrice !== undefined) {
        clauses.push(`price_min <= ${maxPrice}`)
      }
    } else {
      const price: NonNullable<FilterDescriptor["price"]> = {
        ...(minPrice !== undefined ? { min: minPrice } : {}),
        ...(maxPrice !== undefined ? { max: maxPrice } : {}),
      }
      postFilters.push({
        attribute: "price_range",
        price,
      })
    }
  }

  if (inStockOnly) {
    if (filterable.has("stock_status")) {
      clauses.push('(stock_status != "sold_out")')
    } else {
      postFilters.push({
        attribute: "stock_status",
        values: ["in_stock", "low_stock"],
      })
    }
  }

  const filterExpression = clauses.length
    ? (clauses.join(" AND ") as Filter)
    : undefined

  return { filterExpression, postFilters }
}

const canonicalizeFormatFacets = (facet: FacetMap): FacetMap => {
  const canonical: FacetMap = {}
  Object.entries(facet).forEach(([rawKey, count]) => {
    const normalized = normalizeFormatValue(rawKey)
    if (!normalized) {
      return
    }
    canonical[normalized] = (canonical[normalized] ?? 0) + count
  })
  return canonical
}

const buildCanonicalFormatFacet = (
  formatFacet: FacetMap,
  variantFacet: FacetMap | undefined,
  hits: ProductSearchHit[]
): FacetMap => {
  const canonical: FacetMap = canonicalizeFormatFacets(formatFacet)

  if (variantFacet) {
    Object.entries(variantFacet).forEach(([rawKey, count]) => {
      const normalized = normalizeFormatValue(rawKey)
      if (!normalized) {
        return
      }
      canonical[normalized] = (canonical[normalized] ?? 0) + count
    })
  }

  hits.forEach((hit) => {
    const add = (value: string | null | undefined) => {
      const normalized = normalizeFormatValue(value)
      if (!normalized) {
        return
      }
      canonical[normalized] = (canonical[normalized] ?? 0) + 1
    }
    add(hit.format)
    hit.variantTitles?.forEach(add)
    hit.formats?.forEach(add)
  })

  return canonical
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
      if (descriptor.attribute === "price_range") {
        const min = descriptor.price?.min
        const max = descriptor.price?.max
        const low = hit.priceMin ?? hit.priceAmount ?? null
        const high = hit.priceMax ?? hit.priceAmount ?? null
        if (low === null || high === null) {
          return false
        }
        if (min !== undefined && high < min) {
          return false
        }
        if (max !== undefined && low > max) {
          return false
        }
        continue
      }

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
      } else if (
        descriptor.attribute === "format" ||
        descriptor.attribute === "formats"
      ) {
        const formats = [
          hit.format,
          hit.defaultVariant?.title,
          ...(hit.formats ?? []),
          ...(hit.variantTitles ?? []),
        ]
          .map((value) => normalizeFormatValue(value)?.toLowerCase())
          .filter((value): value is string => Boolean(value))
        if (!formats.some((format) => target.has(format))) {
          return false
        }
      } else if (descriptor.attribute === "category_handles") {
        const handles = (hit.categoryHandles ?? []).map((value) =>
          value.toLowerCase()
        )
        const handleSet = new Set(handles)
        if (!values.some((value) => handleSet.has(value.toLowerCase()))) {
          return false
        }
      } else if (descriptor.attribute === "variant_titles") {
        const variants = (hit.variantTitles ?? []).map((value) =>
          value.toLowerCase()
        )
        if (!variants.some((value) => target.has(value))) {
          return false
        }
      } else if (descriptor.attribute === "stock_status") {
        const status = hit.stockStatus?.toLowerCase() ?? ""
        if (!target.has(status)) {
          return false
        }
      } else if (descriptor.attribute === "status") {
        const status = hit.status?.toLowerCase() ?? "published"
        if (!target.has(status)) {
          return false
        }
      } else if (descriptor.attribute === "availability_states") {
        const states = (hit.availabilityStates ?? []).map((value) =>
          value.toLowerCase()
        )
        if (!states.some((value) => target.has(value))) {
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
  availabilityStates: FacetMap
  stockStatuses: FacetMap
  bundleTypes: FacetMap
} => {
  const genres: FacetMap = {}
  const metalGenres: FacetMap = {}
  const format: FacetMap = {}
  const categories: FacetMap = {}
  const variants: FacetMap = {}
  const productTypes: FacetMap = {}
  const availabilityStates: FacetMap = {}
  const stockStatuses: FacetMap = {}
  const bundleTypes: FacetMap = {}

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

    hit.availabilityStates?.forEach((state) => {
      const key = state.trim()
      if (key.length) {
        availabilityStates[key] = (availabilityStates[key] ?? 0) + 1
      }
    })

    hit.stockStatuses?.forEach((state) => {
      const key = state.trim()
      if (key.length) {
        stockStatuses[key] = (stockStatuses[key] ?? 0) + 1
      }
    })

    const bundleTypeKey = hit.bundleType?.trim()
    if (bundleTypeKey) {
      bundleTypes[bundleTypeKey] = (bundleTypes[bundleTypeKey] ?? 0) + 1
    }
  })

  return {
    genres,
    metalGenres,
    format,
    categories,
    variants,
    productTypes,
    availabilityStates,
    stockStatuses,
    bundleTypes,
  }
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
  {
    query,
    limit = 24,
    offset = 0,
    filters,
    sort,
    inStockOnly,
  }: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const index = client.index(PRODUCTS_INDEX)
  const filterable = await ensureFilterableAttributes(index)
  const { filterExpression, postFilters } = buildFilter(
    filters,
    inStockOnly,
    filterable
  )

  const sortMapping: Record<ProductSortOption, string | null> = {
    "title-asc": "title:asc",
    "title-desc": "title:desc",
    newest: "created_at:desc",
    "price-low": "price_amount:asc",
    "price-high": "price_amount:desc",
  }

  const sortDirective = sort ? (sortMapping[sort] ?? null) : null
  const sortDirectives = sortDirective ? [sortDirective] : undefined

  const facetsToRequest: string[] = [
    "genres",
    "metalGenres",
    "formats",
    "format",
    "product_type",
    "availability_states",
    "stock_statuses",
    "bundle_type",
  ]
  if (filterable.has("category_handles")) {
    facetsToRequest.push("category_handles")
  }
  if (filterable.has("variant_titles")) {
    facetsToRequest.push("variant_titles")
  }

  const buildFacets = (
    facetDistribution: SearchResponse<
      Record<string, unknown>
    >["facetDistribution"],
    hits: ProductSearchHit[]
  ): ProductSearchResponse["facets"] => {
    const facetsFromIndex = extractFacetMaps(facetDistribution)
    const fallbackFacets = computeFacetCounts(hits)

    const formatFacetSource =
      Object.keys(facetsFromIndex.format).length > 0
        ? facetsFromIndex.format
        : fallbackFacets.format

    return {
      genres: Object.keys(facetsFromIndex.genres).length
        ? facetsFromIndex.genres
        : fallbackFacets.genres,
      metalGenres: Object.keys(facetsFromIndex.metalGenres).length
        ? facetsFromIndex.metalGenres
        : fallbackFacets.metalGenres,
      format: buildCanonicalFormatFacet(
        formatFacetSource,
        facetsFromIndex.variants,
        hits
      ),
      categories:
        filterable.has("category_handles") &&
        Object.keys(facetsFromIndex.categories).length
          ? facetsFromIndex.categories
          : fallbackFacets.categories,
      variants:
        filterable.has("variant_titles") &&
        Object.keys(facetsFromIndex.variants).length
          ? facetsFromIndex.variants
          : fallbackFacets.variants,
      productTypes: Object.keys(facetsFromIndex.productTypes).length
        ? facetsFromIndex.productTypes
        : fallbackFacets.productTypes,
      availabilityStates: Object.keys(facetsFromIndex.availabilityStates).length
        ? facetsFromIndex.availabilityStates
        : fallbackFacets.availabilityStates,
      stockStatuses: Object.keys(facetsFromIndex.stockStatuses).length
        ? facetsFromIndex.stockStatuses
        : fallbackFacets.stockStatuses,
      bundleTypes: Object.keys(facetsFromIndex.bundleTypes).length
        ? facetsFromIndex.bundleTypes
        : fallbackFacets.bundleTypes,
    }
  }

  const requestedLimit = Math.max(0, Math.trunc(limit))
  const requestedOffset = Math.max(0, Math.trunc(offset ?? 0))

  if (!postFilters.length) {
    const response = await index.search<Record<string, unknown>>(query ?? "", {
      limit: requestedLimit,
      offset: requestedOffset,
      attributesToSearchOn: [...CATALOG_SEARCH_ATTRIBUTES],
      facets: facetsToRequest,
      ...(filterExpression ? { filter: filterExpression } : {}),
      ...(sortDirectives ? { sort: sortDirectives } : {}),
    })
    const hits = response.hits
      .map((hit) => normalizeSearchHit(hit))
      .filter((hit) => hit.handle.trim().length > 0)
      .slice(0, requestedLimit)
    const estimatedTotal = response.estimatedTotalHits
    const total =
      typeof estimatedTotal === "number" && Number.isFinite(estimatedTotal)
        ? Math.max(0, Math.trunc(estimatedTotal))
        : requestedOffset + hits.length
    const nextOffset = requestedOffset + hits.length

    return {
      hits,
      total,
      offset: requestedOffset,
      facets: buildFacets(response.facetDistribution, hits),
      hasMore: nextOffset < total,
      nextOffset,
    }
  }

  const batchSize = Math.max(requestedLimit, 64)
  const filteredOffset = requestedOffset
  let skipFiltered = filteredOffset
  let remainingToCollect = requestedLimit
  let totalFiltered = 0
  let collected: ProductSearchHit[] = []
  let hasMore = false
  let rawOffset = 0
  let facetDistribution: SearchResponse<
    Record<string, unknown>
  >["facetDistribution"]
  const maxBatches = 40

  for (let batch = 0; batch < maxBatches; batch++) {
    const response: SearchResponse<Record<string, unknown>> =
      await index.search<Record<string, unknown>>(query ?? "", {
        limit: batchSize,
        offset: rawOffset,
        attributesToSearchOn: [...CATALOG_SEARCH_ATTRIBUTES],
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

  return {
    hits: collected,
    total: totalFiltered,
    offset: filteredOffset,
    facets: buildFacets(facetDistribution, collected),
    hasMore,
    nextOffset: filteredOffset + collected.length,
  }
}
