import type { HttpTypes } from "@medusajs/types"

import { siteMetadata, seoHelpers } from "@/config/site"

type StoreProduct = HttpTypes.StoreProduct
type StoreVariant = HttpTypes.StoreProductVariant & {
  prices?: Array<{
    amount?: number | null
    currency_code?: string | null
  }> | null
  calculated_price?: {
    currency_code?: string | null
    calculated_amount?: number | null
    original_amount?: number | null
  } | null
  currency_code?: string | null
}

type JsonLd = Record<string, unknown>

type VariantJsonLdShape = {
  sku?: string
  price: string | null
  currency: string
}


export const organizationJsonLd: JsonLd = {
  "@context": "https://schema.org",
  "@type": "MusicStore",
  name: siteMetadata.name,
  alternateName: siteMetadata.shortName,
  description: siteMetadata.description,
  url: siteMetadata.siteUrl,
  logo: siteMetadata.assets.headerLogo,
  image: siteMetadata.assets.ogImage,
  sameAs: Object.values(siteMetadata.socials).filter(Boolean),
  address: {
    "@type": "PostalAddress",
    streetAddress: siteMetadata.contact.address.street,
    addressLocality: siteMetadata.contact.address.locality,
    addressRegion: siteMetadata.contact.address.region,
    postalCode: siteMetadata.contact.address.postalCode,
    addressCountry: siteMetadata.contact.address.country,
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: siteMetadata.contact.email,
      telephone: siteMetadata.contact.phone,
      areaServed: "Worldwide",
      availableLanguage: ["en"],
    },
  ],
}

export const webSiteJsonLd: JsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteMetadata.name,
  url: siteMetadata.siteUrl,
  description: siteMetadata.description,
  inLanguage: siteMetadata.defaultLocale,
  potentialAction: {
    "@type": "SearchAction",
    target: seoHelpers.absolute(siteMetadata.searchPathTemplate),
    "query-input": "required name=search_term_string",
  },
}

export const buildBreadcrumbJsonLd = (
  items: Array<{ name: string; url: string }>
): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: item.url,
  })),
})

export const buildItemListJsonLd = (
  name: string,
  items: Array<{ name: string; url: string }>
): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  name,
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    url: item.url,
  })),
})

export const buildProductJsonLd = ({
  product,
  productUrl,
  variant,
  availability,
  genreTags,
}: {
  product: StoreProduct
  productUrl: string
  variant: VariantJsonLdShape | null
  availability: string
  genreTags: string[]
}): JsonLd => {
  const images =
    product.images?.map((image) => image.url).filter((url): url is string => Boolean(url)) ?? []

  const priceValue = variant?.price
  const priceCurrency = variant?.currency

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title ?? "Remorseless Records Release",
    description:
      product.description ??
      product.subtitle ??
      siteMetadata.description,
    url: productUrl,
    sku: variant?.sku ?? product.handle ?? product.id,
    mpn: product.id ?? undefined,
    image: images,
    brand: product.collection?.title
      ? {
          "@type": "Brand",
          name: product.collection.title,
        }
      : { "@type": "Brand", name: siteMetadata.name },
    category: "Music > Vinyl & CDs",
    releaseDate: product.created_at ?? product.updated_at ?? undefined,
    keywords: genreTags,
    offers:
      priceValue && priceCurrency
        ? {
            "@type": "Offer",
            url: productUrl,
            priceCurrency: priceCurrency.toUpperCase(),
            price: priceValue,
            availability,
            itemCondition: "https://schema.org/NewCondition",
            seller: {
              "@type": "Organization",
              name: siteMetadata.name,
              url: siteMetadata.siteUrl,
            },
          }
        : undefined,
  }
}

export const buildMusicReleaseJsonLd = ({
  product,
  productUrl,
  artist,
  tracks,
  genres,
}: {
  product: StoreProduct
  productUrl: string
  artist: string
  tracks: string[]
  genres: string[]
}): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "MusicAlbum",
  name: product.title ?? "Exclusive Release",
  byArtist: {
    "@type": "MusicGroup",
    name: artist,
  },
  genre: genres.length ? genres : undefined,
  image:
    product.images?.map((image) => image.url).filter((url): url is string => Boolean(url)) ?? [],
  track: tracks.map((title, index) => ({
    "@type": "MusicRecording",
    name: title,
    position: index + 1,
  })),
  datePublished:
    (product as unknown as { published_at?: string }).published_at ??
    product.created_at ??
    undefined,
  inLanguage: siteMetadata.defaultLocale,
  url: productUrl,
  description:
    product.description ??
    product.subtitle ??
    siteMetadata.description,
  albumProductionType: "StudioAlbum",
})

export const selectPrimaryVariantForJsonLd = (product: StoreProduct): VariantJsonLdShape | null => {
  const variant = product?.variants?.[0] as StoreVariant | undefined
  if (!variant) {
    return null
  }

  const firstPrice = Array.isArray(variant.prices) && variant.prices.length ? variant.prices[0] : null

  const firstPriceAmount = typeof firstPrice?.amount === "number" ? firstPrice.amount : null
  const firstPriceCurrency = typeof firstPrice?.currency_code === "string" ? firstPrice.currency_code : null

  const calculatedCurrency =
    typeof variant.calculated_price?.currency_code === "string"
      ? variant.calculated_price.currency_code
      : null
  const calculatedAmount =
    typeof variant.calculated_price?.calculated_amount === "number"
      ? variant.calculated_price.calculated_amount
      : null
  const calculatedOriginalAmount =
    typeof variant.calculated_price?.original_amount === "number"
      ? variant.calculated_price.original_amount
      : null

  const derivedCurrency =
    firstPriceCurrency ??
    calculatedCurrency ??
    (typeof variant.currency_code === "string" ? variant.currency_code : null) ??
    "usd"

  const currency = derivedCurrency.toUpperCase()

  const amount =
    firstPriceAmount ??
    calculatedAmount ??
    calculatedOriginalAmount ??
    null

  return {
    sku: variant.sku ?? variant.id ?? undefined,
    price: amount != null ? (amount / 100).toFixed(2) : null,
    currency,
  }
}
