import type { FacetMap } from "@/lib/search/normalize"
import { extractFacetMaps, normalizeSearchHit } from "@/lib/search/normalize"
import type { ProductSearchHit } from "@/types/product"
import type { Filter, MeiliSearch, SearchResponse } from "meilisearch"

export const PRODUCTS_INDEX = "products"

export type ProductSearchFilters = {
  genres?: string[]
  formats?: string[]
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
  }
  offset: number
}

const buildFilter = (
  filters?: ProductSearchFilters,
  inStockOnly?: boolean
): Filter | undefined => {
  if (!filters && !inStockOnly) {
    return undefined
  }

  const clauses: string[] = []

  if (filters?.genres?.length) {
    const values = filters.genres
      .map((genre) => `"${genre.replace(/"/g, '\\"')}"`)
      .join(", ")
    clauses.push(`genres IN [${values}]`)
  }

  if (filters?.formats?.length) {
    const values = filters.formats
      .map((format) => `"${format.replace(/"/g, '\\"')}"`)
      .join(", ")
    clauses.push(`format IN [${values}]`)
  }

  if (inStockOnly) {
    clauses.push('(stock_status != "sold_out")')
  }

  if (!clauses.length) {
    return undefined
  }

  return clauses.join(" AND ")
}

export const searchProductsWithClient = async (
  client: MeiliSearch,
  { query, limit = 24, offset = 0, filters, sort, inStockOnly }: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const index = client.index(PRODUCTS_INDEX)
  const filterClause = buildFilter(filters, inStockOnly)

  const sortMapping: Record<ProductSortOption, string | null> = {
    alphabetical: null,
    newest: "created_at:desc",
    "price-low": "price_amount:asc",
    "price-high": "price_amount:desc",
  }

  const sortDirective = sort ? sortMapping[sort] ?? null : null
  const sortDirectives = sortDirective ? [sortDirective] : undefined

const response: SearchResponse<Record<string, unknown>> =
    await index.search<Record<string, unknown>>(query ?? "", {
      limit,
      offset,
      facets: ["genres", "format"],
      ...(filterClause ? { filter: filterClause } : {}),
      ...(sortDirectives ? { sort: sortDirectives } : {}),
    })

  const hits = response.hits.map((hit) => normalizeSearchHit(hit))
  const total =
    typeof response.totalHits === "number"
      ? response.totalHits
      : typeof response.estimatedTotalHits === "number"
        ? response.estimatedTotalHits
        : hits.length

  const facets = extractFacetMaps(response.facetDistribution)

  return {
    hits,
    total,
    offset: response.offset ?? offset ?? 0,
    facets,
  }
}
