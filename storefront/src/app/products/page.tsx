import type { Metadata } from "next"
import { headers } from "next/headers"

import ProductSearchExperience from "@/components/product-search-experience"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { getCollectionProductsByHandle } from "@/lib/data/products"
import { searchProductsServer } from "@/lib/search/server"
import type { ProductSearchResponse } from "@/lib/search/search"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"

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
  const pageSize = 36

  const [initialSearch, featured, newest, staff] = await Promise.all([
    searchProductsServer({
      query: "",
      limit: pageSize,
      offset: 0,
      sort: "alphabetical",
    }),
    getCollectionProductsByHandle("featured"),
    getCollectionProductsByHandle("new-releases"),
    getCollectionProductsByHandle("staff-picks"),
  ])

  const curatedHits = [...featured, ...newest, ...staff]
    .map((product) => mapStoreProductToSearchHit(product))
  const mergedHits: ProductSearchResponse["hits"] = []
  const seenHandles = new Set<string>()

  const pushHit = (hit: ProductSearchResponse["hits"][number]) => {
    const handleKey = hit.handle.trim().toLowerCase()
    if (!handleKey.length || seenHandles.has(handleKey)) {
      return
    }
    seenHandles.add(handleKey)
    mergedHits.push(hit)
  }

  curatedHits.forEach(pushHit)
  initialSearch.hits.forEach(pushHit)

  const enrichedSearch: ProductSearchResponse = {
    ...initialSearch,
    hits: mergedHits,
    total: Math.max(initialSearch.total, mergedHits.length),
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
    enrichedSearch.hits.map((hit) => ({
      name: hit.title,
      url: `${origin}/products/${
        hit.handle?.trim()?.length
          ? hit.handle.trim()
          : `${hit.slug.artistSlug}-${hit.slug.albumSlug}`
      }`,
    }))
  )

  return (
    <>
      <ProductSearchExperience
        initialHits={enrichedSearch.hits}
        initialFacets={initialSearch.facets}
        initialTotal={enrichedSearch.total}
        initialOffset={initialSearch.offset}
        pageSize={pageSize}
        initialSort="alphabetical"
      />

      <JsonLd id="catalog-item-list" data={catalogStructuredData} />
    </>
  )
}

export default ProductsPage
