import type { Metadata } from "next"
import ProductSearchExperience from "@/components/product-search-experience"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { getMetalGenreCategories } from "@/lib/data/categories"
import { getFullCatalogHits } from "@/lib/catalog/all"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"
import { buildPublicProductPath } from "@/lib/products/routes"
import { searchProductsServer } from "@/lib/search/server"
import {
  CATALOG_PAGE_SIZE,
  computeFacetCounts,
  type ProductSearchResponse,
} from "@/lib/search/search"
import type { ProductSearchHit } from "@/types/product"

const catalogCanonical = `${siteMetadata.siteUrl}/catalog`

const buildCatalogItemList = (hits: ProductSearchHit[], origin: string) =>
  buildItemListJsonLd(
    "Remorseless Catalog",
    hits.map((hit) => ({
      name: hit.title,
      url: `${origin}${buildPublicProductPath({
        handle:
          hit.handle?.trim() || `${hit.slug.artistSlug}-${hit.slug.albumSlug}`,
        productType: hit.productType,
      })}`,
    }))
  )

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "Dig through Remorseless Records’ full catalog of doom, death, sludge, and stoner metal pressed in limited runs.",
  alternates: {
    canonical: catalogCanonical,
  },
  openGraph: {
    url: catalogCanonical,
    title: "Catalog · Remorseless Records",
    description:
      "Limited releases, micro-batch pressings, and underground metal exclusives.",
  },
  twitter: {
    title: "Catalog · Remorseless Records",
    description:
      "Limited releases, micro-batch pressings, and underground metal exclusives.",
  },
}

const ProductsPage = async () => {
  const origin = siteMetadata.siteUrl
  const { initialResponse, genreFilters } = await loadCatalogViewModel()

  const catalogStructuredData = buildCatalogItemList(
    initialResponse.hits,
    origin
  )

  return (
    <>
      <ProductSearchExperience
        initialResponse={initialResponse}
        initialSort="title-asc"
        genreFilters={genreFilters}
      />

      <JsonLd id="catalog-item-list" data={catalogStructuredData} />
    </>
  )
}

export default ProductsPage

const loadCatalogViewModel = async (): Promise<{
  initialResponse: ProductSearchResponse
  genreFilters: Awaited<ReturnType<typeof getMetalGenreCategories>>
}> => {
  const [initialResponse, genreFilters] = await Promise.all([
    loadInitialSearchResponse(),
    loadGenreFilters(),
  ])
  return { initialResponse, genreFilters }
}

const loadInitialSearchResponse = async (): Promise<ProductSearchResponse> => {
  try {
    return await searchProductsServer({
      query: "",
      limit: CATALOG_PAGE_SIZE,
      offset: 0,
      sort: "title-asc",
      inStockOnly: false,
    })
  } catch (error) {
    console.error("[ProductsPage] falling back from Meilisearch", {
      reason: error instanceof Error ? error.message : error,
    })
    const catalogHits = await getFullCatalogHits()
    const hits = catalogHits.slice(0, CATALOG_PAGE_SIZE)
    return {
      hits,
      total: catalogHits.length,
      offset: 0,
      facets: computeFacetCounts(catalogHits),
      hasMore: catalogHits.length > hits.length,
      nextOffset: hits.length,
    }
  }
}

const loadGenreFilters = async (): Promise<
  Awaited<ReturnType<typeof getMetalGenreCategories>>
> => {
  try {
    return await getMetalGenreCategories()
  } catch (error) {
    console.error("[ProductsPage] falling back without genre filters", {
      reason: error instanceof Error ? error.message : error,
    })
    return []
  }
}
