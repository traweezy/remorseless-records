import type { Metadata } from "next"

import NewsFeed from "@/components/news/news-feed"
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
    <div className="bg-background flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-8 px-4 pb-20 pt-12 lg:gap-10 lg:px-8">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Newsroom
          </p>
          <div className="space-y-3">
            <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
              Dispatches from the crypt
            </h1>
            <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
              Studio reports, release schedules, and the occasional ritual. Scroll the
              feed for the latest label updates and archival notes.
            </p>
          </div>
        </header>

        <section className="flex-1">
          <NewsFeed
            initialEntries={entries}
            totalCount={count}
            pageSize={NEWS_PAGE_SIZE}
          />
        </section>
      </div>
    </div>
  )
}

export default NewsPage
