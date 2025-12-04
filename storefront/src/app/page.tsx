import type { ReactElement } from "react"
import type { Metadata } from "next"

import HeroSection from "@/components/hero-section"
import ProductCarouselSection from "@/components/product-carousel-section"
import { getCollectionProductsByHandle } from "@/lib/data/products"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"

export const revalidate = 120

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

const shuffleProducts = <T,>(items: readonly T[]): T[] => {
  const copy = [...items]
  if (copy.length <= 1) {
    return copy
  }
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(Math.random() * (index + 1))
    if (targetIndex === index) {
      continue
    }
    const current = copy[index]
    const target = copy[targetIndex]
    if (current === undefined || target === undefined) {
      continue
    }
    copy[index] = target
    copy[targetIndex] = current
  }
  return copy
}

const HomePage = async (): Promise<ReactElement> => {
  const [featured, newest, staff] = await Promise.all([
    getCollectionProductsByHandle("featured"),
    getCollectionProductsByHandle("new-releases"),
    getCollectionProductsByHandle("staff-picks"),
  ])
  const randomizedFeatured = shuffleProducts(featured)
  const randomizedNewest = shuffleProducts(newest)
  const randomizedStaff = shuffleProducts(staff)
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
        </main>
      </div>
      <JsonLd id="homepage-featured" data={featuredListJsonLd} />
    </div>
  )
}

export default HomePage
