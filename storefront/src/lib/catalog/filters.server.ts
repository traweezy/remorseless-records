import "server-only"

import { unstable_cache } from "next/cache"

import { getFullCatalogHits } from "@/lib/catalog/all"
import {
  buildCatalogFilterDefinitions,
  buildCatalogPriceRange,
  type CatalogFilterDefinitions,
  type CatalogFilterOption,
  type CatalogPriceRange,
} from "@/lib/catalog/filters"
import { getMetalGenreCategories } from "@/lib/data/categories"
import { searchProductsServer } from "@/lib/search/server"

const describeError = (error: unknown): unknown =>
  error instanceof Error ? error.message : error

const loadGlobalSearchDefinitions = async (): Promise<{
  genres: CatalogFilterOption[]
  productTypes: CatalogFilterOption[]
}> => {
  const [genreSeeds, searchResponse] = await Promise.all([
    getMetalGenreCategories(),
    searchProductsServer({ query: "", limit: 1, offset: 0 }),
  ])
  const definitions = buildCatalogFilterDefinitions([], genreSeeds, {
    genres: Object.keys(searchResponse.facets.metalGenres).length
      ? searchResponse.facets.metalGenres
      : searchResponse.facets.genres,
    productTypes: searchResponse.facets.productTypes,
  })
  return {
    genres: definitions.genres,
    productTypes: definitions.productTypes,
  }
}

export const getCatalogFormatOptions = unstable_cache(
  async (): Promise<CatalogFilterOption[]> => {
    const hits = await getFullCatalogHits()
    if (!hits.length) {
      throw new Error("The public catalog returned no products")
    }
    return buildCatalogFilterDefinitions(hits, []).formats
  },
  ["catalog-format-options-v1"],
  { revalidate: 900, tags: ["products", "catalog-format-options-v1"] }
)

export const getCatalogPriceRange = unstable_cache(
  async (): Promise<CatalogPriceRange> => {
    const hits = await getFullCatalogHits()
    const range = buildCatalogPriceRange(hits)
    if (!range) {
      throw new Error("The public catalog has no priced products")
    }
    return range
  },
  ["catalog-price-range-v1"],
  { revalidate: 900, tags: ["products", "catalog-price-range-v1"] }
)

const getGlobalSearchDefinitions = unstable_cache(
  loadGlobalSearchDefinitions,
  ["catalog-search-filter-options-v1"],
  {
    revalidate: 900,
    tags: ["products", "categories", "catalog-search-filter-options-v1"],
  }
)

export const getCatalogGenreOptions = async (): Promise<
  CatalogFilterOption[]
> => (await getGlobalSearchDefinitions()).genres

export const getCatalogProductTypeOptions = async (): Promise<
  CatalogFilterOption[]
> => (await getGlobalSearchDefinitions()).productTypes

export const getCatalogFilterDefinitions =
  async (): Promise<CatalogFilterDefinitions> => {
    const [formatResult, priceResult, searchResult] = await Promise.allSettled([
      getCatalogFormatOptions(),
      getCatalogPriceRange(),
      getGlobalSearchDefinitions(),
    ])

    if (formatResult.status === "rejected") {
      console.error("[getCatalogFilterDefinitions] Format definitions failed", {
        reason: describeError(formatResult.reason),
      })
    }
    if (searchResult.status === "rejected") {
      console.error("[getCatalogFilterDefinitions] Search definitions failed", {
        reason: describeError(searchResult.reason),
      })
    }
    if (priceResult.status === "rejected") {
      console.error("[getCatalogFilterDefinitions] Price range failed", {
        reason: describeError(priceResult.reason),
      })
    }

    return {
      formats: formatResult.status === "fulfilled" ? formatResult.value : [],
      genres:
        searchResult.status === "fulfilled" ? searchResult.value.genres : [],
      productTypes:
        searchResult.status === "fulfilled"
          ? searchResult.value.productTypes
          : [],
      priceRange: priceResult.status === "fulfilled" ? priceResult.value : null,
    }
  }
