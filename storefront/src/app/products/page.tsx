import type { Metadata } from "next"
import { headers } from "next/headers"

import ProductSearchExperience from "@/components/product-search-experience"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { getRecentProducts } from "@/lib/data/products"
import { searchProductsServer } from "@/lib/search/server"
import type { ProductSearchResponse } from "@/lib/search/search"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"

export const revalidate = 120

const catalogCanonical = `${siteMetadata.siteUrl}/products`

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
  let initialSearch: ProductSearchResponse
  const pageSize = 24

  try {
    initialSearch = await searchProductsServer({
      query: "",
      limit: pageSize,
      offset: 0,
      sort: "alphabetical",
    })
  } catch (error) {
    console.error("Meilisearch query failed, falling back to Medusa data.", error)
    const products = await getRecentProducts(pageSize)
    const hits = products.map(mapStoreProductToSearchHit)
    initialSearch = {
      hits,
      total: hits.length,
      offset: 0,
      facets: {
        genres: {},
        format: {},
      },
    }
  }

  const headerList = await headers()
  const headerEntries = Object.fromEntries(headerList.entries()) as Record<string, string>
  const host =
    headerEntries["x-forwarded-host"] ??
    headerEntries.host ??
    "localhost:3000"
  const protocolHeader = headerEntries["x-forwarded-proto"]
  const protocol = protocolHeader ?? (host.startsWith("localhost") ? "http" : "https")
  const origin = `${protocol}://${host}`

  const catalogStructuredData = buildItemListJsonLd(
    "Remorseless Catalog",
    initialSearch.hits.map((hit) => ({
      name: hit.title,
      url: `${origin}/products/${hit.slug.artistSlug}/${hit.slug.albumSlug}`,
    }))
  )

  return (
    <>
      <ProductSearchExperience
        initialHits={initialSearch.hits}
        initialFacets={initialSearch.facets}
        initialTotal={initialSearch.total}
        initialOffset={initialSearch.offset}
        pageSize={pageSize}
        initialSort="alphabetical"
      />

      <JsonLd id="catalog-item-list" data={catalogStructuredData} />
    </>
  )
}

export default ProductsPage
