import ProductSearchExperience from "@/components/product-search-experience"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { getRecentProducts } from "@/lib/data/products"
import { searchProductsServer } from "@/lib/search/server"
import type { ProductSearchResponse } from "@/lib/search/search"
import { headers } from "next/headers"

export const revalidate = 120

const ProductsPage = async () => {
  let initialSearch: ProductSearchResponse

  try {
    initialSearch = await searchProductsServer({ query: "", limit: 24 })
  } catch (error) {
    console.error("Meilisearch query failed, falling back to Medusa data.", error)
    const products = await getRecentProducts(24)
    const hits = products.map(mapStoreProductToSearchHit)
    initialSearch = {
      hits,
      total: hits.length,
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

  const catalogStructuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: initialSearch.hits.map((hit, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${origin}/products/${hit.handle}`,
      name: hit.title,
    })),
  }

  return (
    <>
      <ProductSearchExperience
        initialHits={initialSearch.hits}
        initialFacets={initialSearch.facets}
        initialTotal={initialSearch.total}
      />

      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(catalogStructuredData),
        }}
      />
    </>
  )
}

export default ProductsPage
