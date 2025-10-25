import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { headers } from "next/headers"

import type { HttpTypes } from "@medusajs/types"

import ProductVariantSelector from "@/components/product-variant-selector"
import ProductCard from "@/components/product-card"
import {
  deriveVariantOptions,
  mapStoreProductToRelatedSummary,
} from "@/lib/products/transformers"
import {
  getProductByHandle,
  getProductsByCollection,
  getRecentProducts,
} from "@/lib/data/products"
import type { RelatedProductSummary } from "@/types/product"

type ProductPageProps = {
  params: { handle: string } | Promise<{ handle: string }>
}

export const revalidate = 120

export const generateMetadata = async ({
  params,
}: ProductPageProps): Promise<Metadata> => {
  const { handle } = await params
  const product = await getProductByHandle(handle)

  if (!product) {
    return {
      title: "Product not found",
    }
  }

  const description =
    product.description ??
    product.subtitle ??
    "Remorseless Records exclusive release."

  const images =
    product.images?.map((image) => ({
      url: image.url,
      alt: product.title ?? "Release artwork",
    })) ?? []

  return {
    title: product.title ?? "Remorseless Records Release",
    description,
    openGraph: {
      title: product.title ?? "Remorseless Records Release",
      description,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: product.title ?? "Remorseless Records Release",
      description,
    },
  }
}

const ProductPage = async ({ params }: ProductPageProps) => {
  const { handle } = await params
  const product = await getProductByHandle(handle)

  if (!product) {
    notFound()
  }

  const variantOptions = deriveVariantOptions(product.variants)
  const relatedProducts = await loadRelatedProducts(product)
  const primaryVariant = product.variants?.[0] ?? null

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

  const headerList = await headers()
  const headerEntries = Object.fromEntries(headerList.entries()) as Record<string, string>
  const host =
    headerEntries["x-forwarded-host"] ??
    headerEntries.host ??
    "localhost:3000"
  const protocolHeader = headerEntries["x-forwarded-proto"]
  const protocol = protocolHeader ?? (host.startsWith("localhost") ? "http" : "https")
  const origin = `${protocol}://${host}`
  const productUrl = `${origin}/products/${product.handle}`
  const defaultVariant = variantOptions[0]
  const availability = defaultVariant?.inStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock"
  const priceValue =
    typeof defaultVariant?.amount === "number"
      ? (defaultVariant.amount / 100).toFixed(2)
      : null
  const productImages = heroImages
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url))

  const productStructuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productTitle,
    description: productDescription,
    image: productImages,
    sku: primaryVariant?.sku ?? undefined,
    brand: product.collection?.title
      ? {
          "@type": "Brand",
          name: product.collection.title,
        }
      : undefined,
    offers:
      defaultVariant && priceValue
        ? {
            "@type": "Offer",
            priceCurrency: (defaultVariant.currency ?? "usd").toUpperCase(),
            price: priceValue,
            availability,
            url: productUrl,
          }
        : undefined,
  }

  return (
    <div className="space-y-16 px-4 py-16">
      <section className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          {heroImages.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {heroImages.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.url}
                  alt={productTitle}
                  className="w-full rounded-xl border border-border/60 bg-background/60 object-cover"
                />
              ))}
            </div>
          ) : (
            <div className="aspect-video rounded-2xl border border-border/60 bg-background/80" />
          )}
        </div>

        <aside className="flex flex-col gap-8">
          <div className="space-y-3 rounded-2xl border border-border/60 bg-surface/90 p-6 shadow-elegant">
            <span className="inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-[0.6rem] uppercase tracking-[0.35rem] text-muted-foreground">
              {product.collection?.title ?? "Limited Run"}
            </span>
            <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
              {productTitle}
            </h1>
            {product.subtitle ? (
              <p className="text-sm text-muted-foreground">
                {product.subtitle}
              </p>
            ) : null}
            {product.tags?.length ? (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {product.tags.map((tag) => (
                  <span
                    key={tag.id ?? tag.value}
                    className="rounded-full border border-border/50 bg-background/80 px-3 py-1 text-[0.55rem] uppercase tracking-[0.3rem] text-muted-foreground"
                  >
                    {tag.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <ProductVariantSelector
            variants={variantOptions}
            productTitle={productTitle}
            redirectPath={`/products/${product.handle}`}
          />

          <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/80 p-6">
            <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
              Description
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {productDescription}
            </p>
          </div>

          {tracklist.length ? (
            <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/80 p-6">
              <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                Tracklist
              </h2>
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
            <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/80 p-6">
              <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                Liner Notes
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {linerNotes}
              </p>
            </div>
          ) : null}

          {metadata ? (
            <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/80 p-6">
              <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                Specs
              </h2>
              <ul className="space-y-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                {Object.entries(metadata)
                  .filter(([key]) => !["tracklist", "notes", "badge"].includes(key.toLowerCase()))
                  .map(([key, value]) => (
                    <li key={key} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground/80">{key.replace(/_/g, " ")}</span>
                      <span className="text-foreground">
                        {typeof value === "string"
                          ? value
                          : Array.isArray(value)
                            ? value.join(", ")
                            : JSON.stringify(value)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </section>

      {relatedProducts.length ? (
        <section className="space-y-6">
          <header className="flex flex-col gap-3">
            <span className="font-headline text-xs uppercase tracking-[0.4rem] text-muted-foreground">
              You Might Also Dig
            </span>
            <h2 className="font-display text-3xl uppercase tracking-[0.3rem] text-foreground">
              Related Assaults
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              More wax pulled from nearby collections and similar sonic territory. Quick shop
              surfaces variants without breaking your listening flow.
            </p>
          </header>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {relatedProducts.map((related) => (
              <ProductCard key={related.id} product={related} />
            ))}
          </div>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productStructuredData),
        }}
      />
    </div>
  )
}

export default ProductPage

const loadRelatedProducts = async (
  product: HttpTypes.StoreProduct
): Promise<RelatedProductSummary[]> => {
  const suggestions: RelatedProductSummary[] = []
  const seen = new Set<string>([product.id])

  const appendSuggestions = (items: HttpTypes.StoreProduct[] | undefined) => {
    items?.forEach((item) => {
      if (!item.id || seen.has(item.id) || item.handle === product.handle) {
        return
      }

      seen.add(item.id)
      suggestions.push(mapStoreProductToRelatedSummary(item))
    })
  }

  const collectionId =
    product.collection?.id ??
    (product as { collection_id?: string }).collection_id ??
    null

  if (collectionId) {
    const fromCollection = await getProductsByCollection(collectionId, 8)
    appendSuggestions(fromCollection)
  }

  if (suggestions.length < 4) {
    const fallback = await getRecentProducts(8)
    appendSuggestions(fallback)
  }

  return suggestions.slice(0, 4)
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
