import type { Metadata } from "next"

import NewsFeed from "@/components/news/news-feed"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { siteMetadata } from "@/config/site"
import { getNewsEntries, NEWS_PAGE_SIZE } from "@/lib/data/news"

const canonical = `${siteMetadata.siteUrl}/news`

export const metadata: Metadata = {
  title: "News",
  description:
    "Dispatches from the label: release updates, studio logs, and archival notes from Remorseless Records.",
  alternates: {
    canonical,
  },
  openGraph: {
    url: canonical,
    title: "News · Remorseless Records",
    description:
      "Release updates, studio dispatches, and archival notes from Remorseless Records.",
  },
  twitter: {
    title: "News · Remorseless Records",
    description:
      "Release updates, studio dispatches, and archival notes from Remorseless Records.",
  },
}

const NewsPage = async () => {
  const { entries, count } = await getNewsEntries()

  return (
    <PageShell
      className="flex min-h-screen flex-col"
      contentClassName="flex-1 pb-20"
    >
      <PageHeader
        className="space-y-4"
        eyebrow="Newsroom"
        title="Dispatches from the crypt"
        description={
          <>
            Studio reports, release schedules, and the occasional ritual. Scroll
            the feed for the latest label updates and archival notes.
          </>
        }
      />

      <section className="flex-1">
        <NewsFeed
          initialEntries={entries}
          totalCount={count}
          pageSize={NEWS_PAGE_SIZE}
        />
      </section>
    </PageShell>
  )
}

export default NewsPage
