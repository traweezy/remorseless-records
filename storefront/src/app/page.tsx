import type { ReactElement } from "react"
import type { Metadata } from "next"

import HeroSection from "@/components/hero-section"
import ProductCarouselSection from "@/components/product-carousel-section"
import NewsCarouselSection from "@/components/news/news-carousel-section"
import { getCollectionProductsByHandle } from "@/lib/data/products"
import { getNewsEntries } from "@/lib/data/news"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"

const homepageCanonical = siteMetadata.siteUrl

export const metadata: Metadata = {
  title: "Underground Metal Label & Store",
  description: siteMetadata.description,
  alternates: {
    canonical: homepageCanonical,
  },
  openGraph: {
    url: homepageCanonical,
    title: `${siteMetadata.name} · Underground Metal Label`,
    description: siteMetadata.description,
    images: [
      {
        url: siteMetadata.assets.ogImage,
        alt: `${siteMetadata.name} hero`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteMetadata.name} · Underground Metal Label`,
    description: siteMetadata.description,
    images: [siteMetadata.assets.ogImage],
  },
}

const hashString = (input: string): number => {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return hash
}

const pseudoShuffle = <T extends { handle?: string | null }>(
  items: readonly T[],
  salt: string
): T[] =>
  [...items].sort((a, b) => {
    const aKey = `${salt}:${a.handle ?? ""}`
    const bKey = `${salt}:${b.handle ?? ""}`
    return hashString(aKey) - hashString(bKey)
  })

const HomePage = async (): Promise<ReactElement> => {
  const [featured, newest, staff, news] = await Promise.all([
    getCollectionProductsByHandle("featured"),
    getCollectionProductsByHandle("new-releases"),
    getCollectionProductsByHandle("staff-picks"),
    getNewsEntries(),
  ])
  const randomizedFeatured = pseudoShuffle(featured, "featured")
  const randomizedNewest = pseudoShuffle(newest, "new-releases")
  const randomizedStaff = pseudoShuffle(staff, "staff-picks")
  const latestNews = news.entries
  const featuredListJsonLd = buildItemListJsonLd(
    "Featured Picks",
    randomizedFeatured
      .filter((product) => typeof product.handle === "string" && product.handle.trim().length)
      .map((product) => {
        const handle = (product.handle ?? "").trim()
        return {
          name: product.title ?? "Exclusive release",
          url: `${siteMetadata.siteUrl}/products/${handle}`,
        }
      })
  )

  return (
    <div className="pb-24">
      <HeroSection />

      <div className="mt-24">
        <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-24 px-4 sm:px-6">
          <ProductCarouselSection
            heading={{ leading: "Featured", highlight: "Picks" }}
            description="Curated slabs hand-picked from the vault—limited, savage, and in stock right now."
            products={randomizedFeatured}
          />

          <ProductCarouselSection
            heading={{ leading: "Newest", highlight: "Arrivals" }}
            description="Fresh represses and new signings—these move fast. Bookmark them or lose them forever."
            products={randomizedNewest}
          />

          <ProductCarouselSection
            heading={{ leading: "Staff", highlight: "Signals" }}
            description="Releases we can&apos;t stop looping. Tuned for the true devotees only."
            products={randomizedStaff}
          />

          <NewsCarouselSection
            heading={{ leading: "Latest", highlight: "News" }}
            description="Dispatches from the label: drops, studio notes, and archive dispatches."
            entries={latestNews}
          />
        </main>
      </div>
      <JsonLd id="homepage-featured" data={featuredListJsonLd} />
    </div>
  )
}

export default HomePage
