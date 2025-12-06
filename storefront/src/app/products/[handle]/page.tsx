import type { Metadata } from "next"
import { notFound } from "next/navigation"

import type { HttpTypes } from "@medusajs/types"

import ProductVariantSelector from "@/components/product-variant-selector"
import ProductGallery from "@/components/product-gallery"
import ProductCarouselSection from "@/components/product-carousel-section"
import { deriveVariantOptions } from "@/lib/products/transformers"
import { getProductByHandle, PRODUCT_DETAIL_FIELDS } from "@/lib/data/products"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import {
  buildBreadcrumbJsonLd,
  buildMusicReleaseJsonLd,
  buildProductJsonLd,
  selectPrimaryVariantForJsonLd,
} from "@/lib/seo/structured-data"
import { extractProductCategoryGroups } from "@/lib/products/categories"
import { buildProductSlugParts } from "@/lib/products/slug"
import { storeClient } from "@/lib/medusa"
import { safeLogError } from "@/lib/logging"

type ProductPageProps = {
  params: { handle: string } | Promise<{ handle: string }>
}

const normalizeHandle = (handle: string | null | undefined): string | null => {
  if (typeof handle !== "string") {
    return null
  }

  const trimmed = handle.trim()
  return trimmed.length ? trimmed : null
}

export const generateMetadata = async ({
  params,
}: ProductPageProps): Promise<Metadata> => {
  const rawParams = await params
  const handle = normalizeHandle(rawParams.handle)

  if (!handle) {
    return {
      title: "Product not found",
    }
  }

  const product = await getProductByHandle(handle)

  if (!product) {
    return {
      title: "Product not found",
    }
  }

  const description =
    product.description ??
    product.subtitle ??
    siteMetadata.description

  const slug = buildProductSlugParts(product)
  const canonHandle = normalizeHandle(product.handle) ?? handle
  const canonical = `${siteMetadata.siteUrl}/products/${canonHandle}`
  const images =
    product.images?.map((image) => ({
      url: image.url,
      alt: product.title ?? "Release artwork",
    })) ?? [
      {
        url: siteMetadata.assets.ogImage,
        alt: `${siteMetadata.name} hero`,
      },
    ]

  const categoryGroups = extractProductCategoryGroups(product.categories, {
    excludeHandles: [slug.artistSlug, slug.albumSlug],
  })
  const categoryKeywords = [
    ...categoryGroups.types.map((entry) => entry.label),
    ...categoryGroups.genres.map((entry) => entry.label),
  ]

  const keywords = [
    ...categoryKeywords,
    ...(product.tags
      ?.map((tag) => tag?.value)
      .filter((value): value is string => Boolean(value)) ?? []),
    ...siteMetadata.keywords,
  ]

  return {
    title: product.title ?? "Remorseless Records Release",
    description,
    alternates: {
      canonical,
    },
    keywords,
    openGraph: {
      title: product.title ?? "Remorseless Records Release",
      description,
      url: canonical,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: product.title ?? "Remorseless Records Release",
      description,
      images: images.map((image) => image.url),
    },
  }
}

const ProductPage = async ({ params }: ProductPageProps) => {
  const rawParams = await params
  const handle = normalizeHandle(rawParams.handle)

  if (!handle) {
    notFound()
  }

  const product = await getProductByHandle(handle)

  if (!product) {
    notFound()
  }

  const slug = buildProductSlugParts(product)
  const categoryGroups = extractProductCategoryGroups(product.categories, {
    excludeHandles: [slug.artistSlug, slug.albumSlug],
  })
  const variantOptions = deriveVariantOptions(product.variants)
  const genreChips = Array.from(
    new Set(
      (categoryGroups.genres ?? []).map((entry) => entry.label).filter((label) => label.trim().length)
    )
  )
  const relatedProducts = await loadRelatedProducts(product)

  const heroImages = product.images ?? []
  const productTitle = product.title ?? "Remorseless Release"
  const productDescription =
    product.description ??
    "Full release notes, tracklists, and variant breakdowns are on the way."

  const metadata = isRecord(product.metadata) ? product.metadata : null

  const tracklist = extractTracklist(metadata)
  const linerNotes =
    typeof metadata?.notes === "string" && metadata.notes.trim().length
      ? metadata.notes.trim()
      : null

  const origin = siteMetadata.siteUrl
  const productPath = `/products/${handle}`
  const productUrl = `${origin}${productPath}`
  const defaultVariant = variantOptions[0]
  const availability = defaultVariant?.inStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock"
  const genreTags =
    categoryGroups.genres.length > 0
      ? categoryGroups.genres.map((entry) => entry.label)
      : (product.tags ?? [])
          .map((tag) => tag?.value?.trim())
          .filter((value): value is string => Boolean(value))
  const metadataArtist =
    typeof metadata?.artist === "string" && metadata.artist.trim().length
      ? metadata.artist.trim()
      : null
  const artistName = metadataArtist ?? product.collection?.title ?? productTitle
  const variantForJsonLd = selectPrimaryVariantForJsonLd(product)
  const collectionHandle =
    (product.collection as { handle?: string } | undefined)?.handle ??
    (product as { collection_handle?: string }).collection_handle ??
    null
  const productJsonLd = buildProductJsonLd({
    product,
    productUrl,
    variant: variantForJsonLd,
    availability,
    genreTags,
  })
  const musicReleaseJsonLd = buildMusicReleaseJsonLd({
    product,
    productUrl,
    artist: artistName,
    tracks: tracklist,
    genres: genreTags,
  })
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: `${origin}/` },
    { name: "Catalog", url: `${origin}/catalog` },
    {
      name: product.collection?.title ?? "Releases",
      url:
        collectionHandle != null
          ? `${origin}/catalog?collection=${collectionHandle}`
          : `${origin}/catalog`,
    },
    { name: productTitle, url: productUrl },
  ])

  return (
    <div className="bg-background">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-12 pt-10 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          <ProductGallery
            images={heroImages.map((image, index) => ({
              id: image.id ?? `image-${index}`,
              url: image.url ?? "/remorseless-hero-logo.png",
              alt: productTitle,
            }))}
            title={productTitle}
          />

          <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
            <div className="space-y-4 rounded-3xl border border-border/70 bg-surface/95 p-6 shadow-[0_32px_60px_-40px_rgba(0,0,0,0.8)]">
              <div className="space-y-2">
                <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
                  {productTitle}
                </h1>
                {product.subtitle ? (
                  <p className="text-sm text-muted-foreground">{product.subtitle}</p>
                ) : null}
              </div>
              {genreChips.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {genreChips.map((genre) => (
                    <span
                      key={`genre-chip-${genre}`}
                      className="rounded-full border border-border/40 bg-background/70 px-3 py-1 text-[0.55rem] uppercase tracking-[0.28rem] text-muted-foreground"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}
              <ProductVariantSelector
                variants={variantOptions}
                productTitle={productTitle}
                redirectPath={productPath}
              />
            </div>

            <div className="space-y-3 rounded-3xl border border-border/70 bg-surface/90 p-6">
              <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                Description
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {productDescription}
              </p>
            </div>

            {tracklist.length ? (
              <div className="space-y-3 rounded-3xl border border-border/70 bg-surface/90 p-6">
                <h3 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                  Tracklist
                </h3>
                <ol className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {tracklist.map((entry, index) => (
                    <li key={`track-${index}`} className="flex items-baseline gap-3">
                      <span className="text-xs font-mono uppercase tracking-[0.35rem] text-muted-foreground/70">
                        {(index + 1).toString().padStart(2, "0")}
                      </span>
                      <span>{entry}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {linerNotes ? (
              <div className="space-y-3 rounded-3xl border border-border/70 bg-surface/90 p-7">
                <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                  Liner Notes
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                  {linerNotes}
                </p>
              </div>
            ) : null}
          </aside>
        </section>

        {relatedProducts.length ? (
          <ProductCarouselSection
            heading={{ leading: "Related", highlight: "Assaults" }}
            description="More wax from this artist and adjacent genres."
            products={relatedProducts}
          />
        ) : null}
      </div>

      <JsonLd
        id={`product-json-${product.id}`}
        data={[productJsonLd, musicReleaseJsonLd, breadcrumbJsonLd]}
      />
    </div>
  )
}

export default ProductPage

const loadRelatedProducts = async (
  product: HttpTypes.StoreProduct
): Promise<HttpTypes.StoreProduct[]> => {
  const limit = 12
  const seen = new Set<string>([
    typeof product.handle === "string" ? product.handle : "",
    typeof product.id === "string" ? product.id : "",
  ])
  const targetSlug = buildProductSlugParts(product)
  const normalizeHandle = (value: string | null | undefined): string | null => {
    if (!value || typeof value !== "string") {
      return null
    }
    const trimmed = value.trim().toLowerCase()
    return trimmed.length ? trimmed : null
  }

  const categoryMeta =
    product.categories
      ?.map((category) => ({
        id: typeof category?.id === "string" ? category.id : null,
        handle: normalizeHandle(category?.handle),
      }))
      .filter((entry): entry is { id: string; handle: string } => Boolean(entry.id) && Boolean(entry.handle)) ?? []

  const artistCategoryIds = categoryMeta
    .filter((entry) => entry.handle === normalizeHandle(targetSlug.artistSlug))
    .map((entry) => entry.id)

  const genreCategoryIds = categoryMeta
    .filter((entry) => entry.handle !== normalizeHandle(targetSlug.artistSlug))
    .map((entry) => entry.id)

  const add = (items: HttpTypes.StoreProduct[] | undefined, bucket: HttpTypes.StoreProduct[]) => {
    items?.forEach((item) => {
      const handle = typeof item.handle === "string" ? item.handle.trim() : ""
      if (!handle || seen.has(handle) || handle === product.handle) {
        return
      }
      seen.add(handle)
      bucket.push(item)
    })
  }

  try {
    const related: HttpTypes.StoreProduct[] = []
    const collectionId =
      (product as { collection_id?: string | null }).collection_id ??
      (product.collection as { id?: string | null } | null)?.id ??
      null

    if (collectionId) {
      const { products } = await storeClient.product.list({
        collection_id: collectionId,
        limit: limit * 2,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      add(products, related)
    }

    if (related.length < limit && artistCategoryIds.length) {
      const { products } = await storeClient.product.list({
        category_id: artistCategoryIds,
        limit: limit * 3,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      add(products, related)
    }

    if (related.length < limit && genreCategoryIds.length) {
      const { products } = await storeClient.product.list({
        category_id: genreCategoryIds,
        limit: limit * 3,
        fields: PRODUCT_DETAIL_FIELDS,
      })
      add(products, related)
    }

    if (related.length < limit) {
      const { products } = await storeClient.product.list({
        limit: limit * 2,
        order: "-created_at",
        fields: PRODUCT_DETAIL_FIELDS,
      })
      add(products, related)
    }

    return related.slice(0, limit)
  } catch (error) {
    safeLogError("[related] falling back to empty set", error)
    return []
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const extractTracklist = (metadata: Record<string, unknown> | null): string[] => {
  if (!metadata) {
    return []
  }

  const raw = metadata.tracklist

  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry): entry is string => Boolean(entry))
  }

  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return []
}
