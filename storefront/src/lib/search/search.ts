import type { FacetMap } from "@/lib/search/normalize"
import { extractFacetMaps, normalizeSearchHit } from "@/lib/search/normalize"
import type { ProductSearchHit } from "@/types/product"
import type { Filter, MeiliSearch, SearchResponse } from "meilisearch"

export const PRODUCTS_INDEX = "products"

export type ProductSearchFilters = {
  genres?: string[]
  formats?: string[]
}

export type ProductSearchRequest = {
  query: string
  limit?: number
  filters?: ProductSearchFilters
}

export type ProductSearchResponse = {
  hits: ProductSearchHit[]
  total: number
  facets: {
    genres: FacetMap
    format: FacetMap
  }
}

const buildFilter = (filters?: ProductSearchFilters): Filter | undefined => {
  if (!filters) {
    return undefined
  }

  const clauses: string[] = []

  if (filters.genres?.length) {
    const values = filters.genres
      .map((genre) => `"${genre.replace(/"/g, '\\"')}"`)
      .join(", ")
    clauses.push(`genres IN [${values}]`)
  }

  if (filters.formats?.length) {
    const values = filters.formats
      .map((format) => `"${format.replace(/"/g, '\\"')}"`)
      .join(", ")
    clauses.push(`format IN [${values}]`)
  }

  if (!clauses.length) {
    return undefined
  }

  return clauses.join(" AND ")
}

export const searchProductsWithClient = async (
  client: MeiliSearch,
  { query, limit = 24, filters }: ProductSearchRequest
): Promise<ProductSearchResponse> => {
  const index = client.index(PRODUCTS_INDEX)
  const filterClause = buildFilter(filters)

  const response: SearchResponse<Record<string, unknown>> =
    await index.search<Record<string, unknown>>(query ?? "", {
      limit,
      facets: ["genres", "format"],
      ...(filterClause ? { filter: filterClause } : {}),
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
    facets,
  }
}
