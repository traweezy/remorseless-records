import type { Metadata } from "next"
import ProductSearchExperience from "@/components/product-search-experience"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { getCollectionProductsByHandle } from "@/lib/data/products"
import { getMetalGenreCategories } from "@/lib/data/categories"
import { getFullCatalogHits } from "@/lib/catalog/all"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"
import { mapStoreProductToSearchHit } from "@/lib/products/transformers"

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
  const [catalogHits, featured, newest, staff, genreFilters] = await Promise.all([
    getFullCatalogHits(),
    getCollectionProductsByHandle("featured"),
    getCollectionProductsByHandle("new-releases"),
    getCollectionProductsByHandle("staff-picks"),
    getMetalGenreCategories(),
  ])

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
