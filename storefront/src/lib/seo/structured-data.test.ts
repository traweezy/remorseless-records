import { faker } from "@faker-js/faker"
import type { HttpTypes } from "@medusajs/types"
import { beforeEach, describe, expect, it, vi } from "vitest"

type StoreProduct = HttpTypes.StoreProduct

const buildMocks = () => {
  const siteUrl = faker.internet.url()
  const logoUrl = faker.internet.url()
  const ogImage = faker.internet.url()
  const searchPathTemplate = "/products?query={search_term_string}"

  vi.doMock("@/config/site", () => ({
    siteMetadata: {
      name: faker.company.name(),
      shortName: faker.company.buzzNoun(),
      tagline: faker.company.catchPhrase(),
      description: faker.company.catchPhraseDescriptor(),
      siteUrl,
      defaultLocale: "en-US",
      socials: {
        instagram: faker.internet.url(),
        bandcamp: faker.internet.url(),
        youtube: null,
      },
      contact: {
        email: faker.internet.email(),
        phone: faker.phone.number(),
        address: {
          street: faker.location.streetAddress(),
          locality: faker.location.city(),
          region: faker.location.state({ abbreviated: true }),
          postalCode: faker.location.zipCode(),
          country: "US",
        },
      },
      assets: {
        headerLogo: logoUrl,
        ogImage,
      },
      searchPathTemplate,
    },
    seoHelpers: {
      absolute: (path: string) => new URL(path, siteUrl).toString(),
    },
  }))

  return { siteUrl, logoUrl, ogImage, searchPathTemplate }
}

describe("structured data helpers", () => {
  beforeEach(() => {
    faker.seed(1701)
    vi.resetModules()
  })

  it("exports top-level organization and website schemas", async () => {
    const { siteUrl, logoUrl, ogImage } = buildMocks()
    const { organizationJsonLd, webSiteJsonLd } = await import("@/lib/seo/structured-data")

    expect(organizationJsonLd).toMatchObject({
      "@type": "MusicStore",
      url: siteUrl,
      logo: logoUrl,
      image: ogImage,
    })
    expect(webSiteJsonLd).toMatchObject({
      "@type": "WebSite",
      url: siteUrl,
    })
  })

  it("builds breadcrumb and item list json-ld", async () => {
    buildMocks()
    const { buildBreadcrumbJsonLd, buildItemListJsonLd } = await import(
      "@/lib/seo/structured-data"
    )

    const items = [
      { name: faker.word.words(1), url: faker.internet.url() },
      { name: faker.word.words(1), url: faker.internet.url() },
    ]

    expect(buildBreadcrumbJsonLd(items)).toMatchObject({
      "@type": "BreadcrumbList",
    })
    expect(buildItemListJsonLd(faker.word.words(2), items)).toMatchObject({
      "@type": "ItemList",
    })
  })

  it("builds product and music release schema", async () => {
    buildMocks()
    const {
      buildMusicReleaseJsonLd,
      buildProductJsonLd,
      selectPrimaryVariantForJsonLd,
    } = await import("@/lib/seo/structured-data")

    const amount = faker.number.int({ min: 1200, max: 4000 })
    const originalAmount = amount + faker.number.int({ min: 100, max: 500 })
    const handle = faker.helpers.slugify(faker.music.songName()).toLowerCase()
    const variantSku = faker.string.alphanumeric(8).toUpperCase()
    const product = {
      id: faker.string.uuid(),
      handle,
      title: faker.music.songName(),
      description: faker.lorem.sentence(),
      subtitle: faker.lorem.words(2),
      images: [{ url: faker.internet.url() }],
      collection: { title: faker.company.name() },
      created_at: faker.date.past().toISOString(),
      updated_at: faker.date.recent().toISOString(),
      variants: [
        {
          id: faker.string.uuid(),
          sku: variantSku,
          prices: [{ amount, currency_code: "usd" }],
          calculated_price: {
            calculated_amount: amount,
            original_amount: originalAmount,
            currency_code: "usd",
          },
        },
      ],
    } as unknown as StoreProduct

    const productUrl = faker.internet.url()
    const variant = selectPrimaryVariantForJsonLd(product)
    const productJsonLd = buildProductJsonLd({
      product,
      productUrl,
      variant,
      availability: "https://schema.org/InStock",
      genreTags: [faker.music.genre()],
    })
    const albumJsonLd = buildMusicReleaseJsonLd({
      product,
      productUrl,
      artist: faker.person.fullName(),
      tracks: [faker.music.songName()],
      genres: [faker.music.genre()],
    })

    expect(variant).toEqual({
      sku: variantSku,
      price: (amount / 100).toFixed(2),
      currency: "USD",
    })
    expect(productJsonLd).toMatchObject({
      "@type": "Product",
      url: productUrl,
    })
    expect(albumJsonLd).toMatchObject({
      "@type": "MusicAlbum",
      url: productUrl,
    })
  })

  it("returns null variant when product has no variants", async () => {
    buildMocks()
    const { selectPrimaryVariantForJsonLd } = await import(
      "@/lib/seo/structured-data"
    )
    const product = { variants: [] } as unknown as StoreProduct
    expect(selectPrimaryVariantForJsonLd(product)).toBeNull()
  })

  it("falls back product schema fields when variant pricing is unavailable", async () => {
    buildMocks()
    const { buildProductJsonLd } = await import("@/lib/seo/structured-data")
    const product = {
      id: faker.string.uuid(),
      handle: faker.helpers.slugify(faker.music.songName()).toLowerCase(),
      title: null,
      description: null,
      subtitle: faker.lorem.words(3),
      images: [],
      collection: null,
      created_at: null,
      updated_at: faker.date.recent().toISOString(),
      variants: [],
    } as unknown as StoreProduct

    const jsonLd = buildProductJsonLd({
      product,
      productUrl: faker.internet.url(),
      variant: null,
      availability: "https://schema.org/OutOfStock",
      genreTags: [],
    })

    expect(jsonLd).toMatchObject({
      "@type": "Product",
      name: "Remorseless Records Release",
      brand: { "@type": "Brand" },
      offers: undefined,
      releaseDate: product.updated_at,
    })
  })

  it("derives variant price and currency from calculated fields", async () => {
    buildMocks()
    const { selectPrimaryVariantForJsonLd } = await import(
      "@/lib/seo/structured-data"
    )

    const amount = faker.number.int({ min: 1000, max: 9999 })
    const product = {
      variants: [
        {
          id: faker.string.uuid(),
          sku: null,
          prices: [{ amount: null, currency_code: null }],
          calculated_price: {
            calculated_amount: amount,
            original_amount: null,
            currency_code: "eur",
          },
          currency_code: null,
        },
      ],
    } as unknown as StoreProduct

    const variant = selectPrimaryVariantForJsonLd(product)
    expect(typeof variant?.sku).toBe("string")
    expect(variant).toMatchObject({
      price: (amount / 100).toFixed(2),
      currency: "EUR",
    })
  })

  it("falls back to default usd currency and null price when variant is sparse", async () => {
    buildMocks()
    const { buildMusicReleaseJsonLd, selectPrimaryVariantForJsonLd } = await import(
      "@/lib/seo/structured-data"
    )

    const product = {
      id: faker.string.uuid(),
      title: faker.music.songName(),
      subtitle: faker.lorem.words(2),
      description: null,
      images: [],
      created_at: faker.date.past().toISOString(),
      variants: [
        {
          id: faker.string.uuid(),
          sku: faker.string.alphanumeric(7).toUpperCase(),
          prices: [],
          calculated_price: null,
          currency_code: null,
        },
      ],
    } as unknown as StoreProduct

    const sparseVariant = selectPrimaryVariantForJsonLd(product)
    expect(typeof sparseVariant?.sku).toBe("string")
    expect(sparseVariant).toMatchObject({
      price: null,
      currency: "USD",
    })

    const albumJsonLd = buildMusicReleaseJsonLd({
      product,
      productUrl: faker.internet.url(),
      artist: faker.person.fullName(),
      tracks: [faker.music.songName()],
      genres: [],
    })
    expect(albumJsonLd).toMatchObject({
      "@type": "MusicAlbum",
      genre: undefined,
    })
  })
})
