import type { Metadata, ReactElement } from "react"
import Link from "next/link"

import HeroSection from "@/components/hero-section"
import ProductCard from "@/components/product-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getHomepageProducts } from "@/lib/data/products"
import JsonLd from "@/components/json-ld"
import { siteMetadata } from "@/config/site"
import { buildItemListJsonLd } from "@/lib/seo/structured-data"

const GENRE_ROUTES = [
  {
    name: "Blackened Doom",
    description: "Glacial tempos drenched in feedback.",
    href: "/products?genre=blackened-doom",
  },
  {
    name: "Deathgrind",
    description: "Blast beats, whiplash riffs, total annihilation.",
    href: "/products?genre=deathgrind",
  },
  {
    name: "Industrial",
    description: "Cold machinery and caustic distortion.",
    href: "/products?genre=industrial",
  },
]

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

const HomePage = async (): Promise<ReactElement> => {
  const products = await getHomepageProducts()

  const featured = products.slice(0, 4)
  const newest = products.slice(4, 8)
  const staff = products.slice(8, 12)
  const featuredListJsonLd = buildItemListJsonLd(
    "Featured Picks",
    featured.map((product) => ({
      name: product.title ?? "Exclusive release",
      url: `${siteMetadata.siteUrl}/products/${product.handle ?? product.id}`,
    }))
  )

  return (
    <div className="pb-24">
      <HeroSection />

      <main className="mx-auto mt-24 flex w-full max-w-6xl flex-col gap-24 px-4">
        <section className="space-y-10">
          <header className="text-center">
            <h2 className="font-bebas text-5xl uppercase tracking-[0.55rem] text-foreground md:text-6xl">
              Featured <span className="text-destructive">Picks</span>
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              Curated slabs hand-picked from the vault—limited, savage, and in stock right now.
            </p>
          </header>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        <section className="space-y-10">
          <header className="text-center">
            <h2 className="font-bebas text-5xl uppercase tracking-[0.55rem] text-foreground md:text-6xl">
              Newest <span className="text-destructive">Arrivals</span>
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              Fresh represses and new signings—these move fast. Bookmark them or lose them forever.
            </p>
          </header>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {newest.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        <section className="space-y-10">
          <header className="text-center">
            <h2 className="font-bebas text-5xl uppercase tracking-[0.55rem] text-foreground md:text-6xl">
              Staff <span className="text-destructive">Signals</span>
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              Releases we can&apos;t stop looping. Tuned for the true devotees only.
            </p>
          </header>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {staff.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>

        <section className="space-y-8 rounded-[2.25rem] border border-border/70 bg-gradient-section p-8 shadow-card md:p-12">
          <header className="flex flex-col gap-3 text-center md:flex-row md:items-center md:justify-between md:text-left">
            <div>
              <h2 className="font-bebas text-4xl uppercase tracking-[0.55rem] text-foreground md:text-5xl">
                Explore the Underground
              </h2>
              <p className="text-sm text-muted-foreground md:text-base">
                Tap a frequency and we&apos;ll route you to curated collections built for maximum impact.
              </p>
            </div>
            <Button asChild variant="ghost" className="border border-border px-6 py-3 text-xs uppercase tracking-[0.35rem] hover:border-destructive hover:text-destructive">
              <Link href="/products">Browse All</Link>
            </Button>
          </header>
          <div className="grid gap-4 md:grid-cols-3">
            {GENRE_ROUTES.map((genre) => (
              <Link
                key={genre.href}
                href={genre.href}
                className="group relative overflow-hidden rounded-2xl border border-border/60 bg-background/80 px-6 py-6 transition hover:border-destructive"
              >
                <span className="font-headline text-sm uppercase tracking-[0.4rem] text-foreground">
                  {genre.name}
                </span>
                <p className="mt-2 text-xs text-muted-foreground">{genre.description}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition group-hover:text-destructive">
                  Enter <span aria-hidden>→</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-3 text-center">
            <h2 className="font-bebas text-4xl uppercase tracking-[0.55rem]">Logistics for the void</h2>
            <p className="text-sm text-muted-foreground md:text-base">
              Pressed in micro batches, fulfilled with precision, shipped worldwide.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {["02 Day turnarounds", "Global fulfilment", "Archival-grade packaging"].map((tagline) => (
              <Card key={tagline} className="border border-border/50 bg-background/70">
                <CardContent className="space-y-3 p-6">
                  <Badge variant="accent" className="px-3 py-1 text-xs">
                    Remorseless Ops
                  </Badge>
                  <p className="font-headline text-base uppercase tracking-[0.35rem] text-foreground">
                    {tagline}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No warehouse dust, no corner bends. Every order is handled like a master lacquer.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <JsonLd id="homepage-featured" data={featuredListJsonLd} />
    </div>
  )
}

export default HomePage
