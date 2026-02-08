import type { Metadata } from "next"

import DiscographyTable from "@/components/discography/discography-table"
import { siteMetadata } from "@/config/site"
import { getDiscographyEntries } from "@/lib/data/discography"

const canonical = `${siteMetadata.siteUrl}/discography`

export const metadata: Metadata = {
  title: "Discography",
  description:
    "Every Remorseless Records release—past, present, and future. Browse the full catalog with formats, tags, years, and availability.",
  alternates: {
    canonical,
  },
  openGraph: {
    url: canonical,
    title: "Discography · Remorseless Records",
    description:
      "All official releases from Remorseless Records. Filter by format, tags, year, availability, and artist.",
  },
  twitter: {
    title: "Discography · Remorseless Records",
    description:
      "Browse every Remorseless Records release across vinyl, cassette, CD, and digital.",
  },
}

const DiscographyPage = async () => {
  const entries = await getDiscographyEntries()

  return (
    <div className="bg-background flex h-full min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 pb-16 pt-12 lg:px-8">
        <header className="space-y-4 flex-0">
          <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Discography
          </p>
          <div className="space-y-3">
            <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
              Label catalog
            </h1>
            <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
              Every release we have put out—vinyl, tape, digital-only, and out-of-print titles.
              Sort by year, filter by format and tags, and jump into the store when copies are available.
            </p>
          </div>
        </header>

        <section className="flex-1 min-h-[20rem] flex flex-col gap-4">
          <DiscographyTable entries={entries} className="flex-1" />
        </section>
      </div>
    </div>
  )
}

export default DiscographyPage
