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
}

export type ProductSortOption =
  | "alphabetical"
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
    format: FacetMap
    categories: FacetMap
    variants: FacetMap
  }
  offset: number
}

type FilterDescriptor = {
  attribute: "genres" | "format" | "category_handles" | "variant_titles" | "stock_status"
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
  tryFilter("category_handles", filters?.categories)
  tryFilter("variant_titles", filters?.variants)

  if (inStockOnly) {
    clauses.push('(stock_status != "sold_out")')
  }

  const filterExpression = clauses.length ? (clauses.join(" AND ") as Filter) : undefined

  return { filterExpression, postFilters }
}

const filterHitsClientSide = (
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
        if (!handles.some((value) => target.has(value))) {
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

const computeFacetCounts = (
  hits: ProductSearchHit[]
): {
  genres: FacetMap
  format: FacetMap
  categories: FacetMap
  variants: FacetMap
} => {
  const genres: FacetMap = {}
  const format: FacetMap = {}
  const categories: FacetMap = {}
  const variants: FacetMap = {}

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

    hit.variantTitles?.forEach((variant) => {
      if (!variant) {
        return
      }
      const key = variant.trim()
      if (key.length) {
        variants[key] = (variants[key] ?? 0) + 1
      }
    })
  })

  return { genres, format, categories, variants }
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
    alphabetical: null,
    newest: "created_at:desc",
    "price-low": "price_amount:asc",
    "price-high": "price_amount:desc",
  }

  const sortDirective = sort ? sortMapping[sort] ?? null : null
  const sortDirectives = sortDirective ? [sortDirective] : undefined

  const facetsToRequest: string[] = ["genres", "format"]
  if (filterable.has("category_handles")) {
    facetsToRequest.push("category_handles")
  }
  if (filterable.has("variant_titles")) {
    facetsToRequest.push("variant_titles")
  }
  const response: SearchResponse<Record<string, unknown>> =
    await index.search<Record<string, unknown>>(query ?? "", {
      limit,
      offset,
      facets: facetsToRequest,
      ...(filterExpression ? { filter: filterExpression } : {}),
      ...(sortDirectives ? { sort: sortDirectives } : {}),
    })

  let hits = response.hits
    .map((hit) => normalizeSearchHit(hit))
    .filter((hit) => hit.handle.trim().length > 0)
  if (postFilters.length) {
    hits = filterHitsClientSide(hits, postFilters)
  }
  const manualFilterApplied = postFilters.some((descriptor) =>
    descriptor.attribute === "category_handles" || descriptor.attribute === "variant_titles"
  )

  const total = manualFilterApplied
    ? hits.length
    : typeof response.totalHits === "number"
        ? response.totalHits
        : typeof response.estimatedTotalHits === "number"
          ? response.estimatedTotalHits
          : hits.length

  const facetsFromIndex = extractFacetMaps(response.facetDistribution)
  const fallbackFacets = computeFacetCounts(hits)

  const facets = {
    genres: Object.keys(facetsFromIndex.genres).length
      ? facetsFromIndex.genres
      : fallbackFacets.genres,
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
  }

  return {
    hits,
    total,
    offset: response.offset ?? offset ?? 0,
    facets,
  }
}
