import type { ReactElement } from "react"
import type { Metadata } from "next"

import HeroSection from "@/components/hero-section"
import ProductCarouselSection from "@/components/product-carousel-section"
import NewsCarouselSection from "@/components/news/news-carousel-section"
import { getHomepageShelves } from "@/lib/data/shelves"
import { getNewsEntries } from "@/lib/data/news"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"
import { buildPublicProductPath } from "@/lib/products/routes"

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

const splitHeading = (title: string): { leading: string; highlight: string } => {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) {
    return { leading: title.trim(), highlight: "" }
  }
  return {
    leading: words.slice(0, -1).join(" "),
    highlight: words.at(-1) ?? "",
  }
}

const HomePage = async (): Promise<ReactElement> => {
  const [shelves, news] = await Promise.all([
    getHomepageShelves(),
    getNewsEntries(),
  ])
  const featured = shelves.featured
  const newest = shelves["new-releases"]
  const staff = shelves["staff-picks"]
  const latestNews = news.entries
  const featuredListJsonLd = buildItemListJsonLd(
    featured.title,
    featured.products
      .filter(
        (product) =>
          typeof product.handle === "string" && product.handle.trim().length
      )
      .map((product) => {
        const handle = (product.handle ?? "").trim()
        return {
          name: product.title ?? "Exclusive release",
          url: `${siteMetadata.siteUrl}${buildPublicProductPath({ handle })}`,
        }
      })
  )

  return (
    <div className="pb-24">
      <HeroSection />

      <div className="mt-24">
        <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-24 px-4 sm:px-6">
          <ProductCarouselSection
            heading={splitHeading(featured.title)}
            description={featured.description}
            products={featured.products}
          />

          <ProductCarouselSection
            heading={splitHeading(newest.title)}
            description={newest.description}
            products={newest.products}
          />

          <ProductCarouselSection
            heading={splitHeading(staff.title)}
            description={staff.description}
            products={staff.products}
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
