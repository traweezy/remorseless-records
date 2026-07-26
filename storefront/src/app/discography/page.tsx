import type { Metadata } from "next"

import DiscographyTable from "@/components/discography/discography-table"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
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
    <PageShell className="min-h-screen" contentClassName="gap-6 lg:gap-8">
      <PageHeader
        className="space-y-4"
        eyebrow="Discography"
        title="Label catalog"
        description={
          <>
            Every release we have put out—vinyl, tape, digital-only, and
            out-of-print titles. Sort by year, filter by format and tags, and
            jump into the store when copies are available.
          </>
        }
      />

      <section className="min-h-[20rem]" aria-label="Discography releases">
        <DiscographyTable entries={entries} />
      </section>
    </PageShell>
  )
}

export default DiscographyPage
