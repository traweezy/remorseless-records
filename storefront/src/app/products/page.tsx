import type { Metadata } from "next"
import type { HttpTypes } from "@medusajs/types"
import ProductSearchExperience from "@/components/product-search-experience"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { getCollectionProductsByHandle } from "@/lib/data/products"
import { getMetalGenreCategories } from "@/lib/data/categories"
import { getFullCatalogHits } from "@/lib/catalog/all"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"
import type { ProductSearchHit } from "@/types/product"

const catalogCanonical = `${siteMetadata.siteUrl}/catalog`

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
  const [catalogHits, featured, newest, staff, genreFilters] = await loadCatalogData()

  const curatedHits = [...featured, ...newest, ...staff]
    .map((product) => mapStoreProductToSearchHit(product))
  const seenHandles = new Set(
    curatedHits
      .map((hit) => hit.handle?.trim().toLowerCase())
      .filter((handle): handle is string => Boolean(handle))
  )

  const combinedHits = [...curatedHits]
  catalogHits.forEach((hit) => {
    const handleKey = hit.handle?.trim().toLowerCase()
    if (!handleKey || seenHandles.has(handleKey)) {
      return
    }
    seenHandles.add(handleKey)
    combinedHits.push(hit)
  })

  const origin = siteMetadata.siteUrl

  const catalogStructuredData = buildItemListJsonLd(
    "Remorseless Catalog",
    combinedHits.map((hit) => ({
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
        initialHits={combinedHits}
        initialSort="title-asc"
        genreFilters={genreFilters}
      />

      <JsonLd id="catalog-item-list" data={catalogStructuredData} />
    </>
  )
}

export default ProductsPage

const loadCatalogData = async () => {
  async function safe<T>(
    label: string,
    fn: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      console.error("[ProductsPage] falling back for dataset", {
        label,
        reason: error instanceof Error ? error.message : error,
      })
      return fallback
    }
  }

  const catalogHits = await safe<ProductSearchHit[]>("catalog", getFullCatalogHits, [])
  const featured = await safe<HttpTypes.StoreProduct[]>(
    "featured",
    () => getCollectionProductsByHandle("featured"),
    []
  )
  const newest = await safe<HttpTypes.StoreProduct[]>(
    "new-releases",
    () => getCollectionProductsByHandle("new-releases"),
    []
  )
  const staff = await safe<HttpTypes.StoreProduct[]>(
    "staff-picks",
    () => getCollectionProductsByHandle("staff-picks"),
    []
  )
  const genreFilters = await safe<Awaited<ReturnType<typeof getMetalGenreCategories>>>(
    "genres",
    getMetalGenreCategories,
    []
  )

  return [catalogHits, featured, newest, staff, genreFilters] as const
}
