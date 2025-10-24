import ProductSearchExperience from "@/components/product-search-experience"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import { storeClient } from "@/lib/medusa"
import { searchProductsServer } from "@/lib/search/server"
import type { ProductSearchResponse } from "@/lib/search/search"
import { headers } from "next/headers"

const ProductsPage = async () => {
  let initialSearch: ProductSearchResponse

  try {
    initialSearch = await searchProductsServer({ query: "", limit: 24 })
  } catch (error) {
    console.error("Meilisearch query failed, falling back to Medusa data.", error)
    const { products } = await storeClient.product.list({ limit: 24 })
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
    <div className="space-y-10 px-4 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-headline text-xs uppercase tracking-[0.7rem] text-muted-foreground">
          Releases
        </p>
        <h1 className="font-display text-5xl uppercase tracking-[0.35rem] text-foreground">
          Catalog
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Search the vault in real time, filter by genres and formats, and quick-add without
          losing your place. Results stream directly from Meilisearch so you can chase the next
          skull-crushing pressing immediately.
        </p>
      </header>

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
    </div>
  )
}

export default ProductsPage
