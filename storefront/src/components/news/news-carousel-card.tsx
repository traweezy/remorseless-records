"use client"

import { memo, useMemo } from "react"
import Image from "next/image"

import { Badge } from "@/components/ui/badge"
import type { NewsEntry } from "@/lib/data/news"

type NewsCarouselCardProps = {
  entry: NewsEntry
}

const NewsCarouselCard = memo<NewsCarouselCardProps>(({ entry }) => {
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    []
  )

  const publishedLabel = useMemo(() => {
    const source = entry.publishedAt ?? entry.createdAt
    if (!source) {
      return "Undated"
    }
    const parsed = new Date(source)
    if (Number.isNaN(parsed.getTime())) {
      return "Undated"
    }
    return dateFormatter.format(parsed)
  }, [dateFormatter, entry.createdAt, entry.publishedAt])

  const coverAlt = useMemo(
    () => `${entry.title} cover artwork`,
    [entry.title]
  )

  const tagList = useMemo(
    () => (Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : []),
    [entry.tags]
  )

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-border/50 bg-muted/10 shadow-lg shadow-black/5">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {entry.coverUrl ? (
          <Image
            src={entry.coverUrl}
            alt={coverAlt}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition duration-500 ease-out hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
          {publishedLabel}
        </div>
        <h3 className="font-display text-2xl uppercase tracking-[0.2rem] text-foreground">
          {entry.title}
        </h3>
        {entry.excerpt ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {entry.excerpt}
          </p>
        ) : null}
        {tagList.length ? (
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            {tagList.map((tag) => (
              <Badge key={tag} variant="secondary" className="uppercase tracking-[0.2rem]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
})

NewsCarouselCard.displayName = "NewsCarouselCard"

export default NewsCarouselCard
