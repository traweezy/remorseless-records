"use client"

import { memo, useMemo } from "react"
import Image from "next/image"

import { Badge } from "@/components/ui/badge"
import SmartLink from "@/components/ui/smart-link"
import { cn } from "@/lib/ui/cn"
import type { NewsEntry } from "@/lib/data/news"
import { sanitizeNewsHtml } from "@/lib/news/rich-text"

type NewsCardProps = {
  entry: NewsEntry
  index: number
}

const NewsCard = memo<NewsCardProps>(({ entry, index }) => {
  const isReversed = index % 2 === 1
  const layoutClassName = useMemo(
    () =>
      cn(
        "flex flex-col gap-6 md:items-stretch md:gap-10",
        isReversed ? "md:flex-row-reverse" : "md:flex-row"
      ),
    [isReversed]
  )

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

  const sanitizedContent = useMemo(
    () => sanitizeNewsHtml(entry.content),
    [entry.content]
  )

  const tagList = useMemo(
    () => (Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : []),
    [entry.tags]
  )

  const coverAlt = useMemo(
    () => `${entry.title} cover artwork`,
    [entry.title]
  )

  const detailHref = useMemo(() => `/news/${entry.slug}`, [entry.slug])

  return (
    <article className="group rounded-3xl border border-border/50 bg-muted/10 p-5 shadow-lg shadow-black/5 backdrop-blur-sm md:p-8">
      <div className={layoutClassName}>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border/50 bg-muted md:w-5/12">
          {entry.coverUrl ? (
            <Image
              src={entry.coverUrl}
              alt={coverAlt}
              fill
              sizes="(max-width: 768px) 100vw, 40vw"
              className="object-cover transition duration-500 ease-out group-hover:scale-[1.02]"
              priority={index < 2}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3rem] text-muted-foreground">
              No image
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
            <span>{publishedLabel}</span>
            {entry.author ? (
              <span className="text-foreground/70">By {entry.author}</span>
            ) : null}
          </div>
          <SmartLink href={detailHref} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <h2 className="font-display text-3xl uppercase tracking-[0.2rem] text-foreground">
              {entry.title}
            </h2>
          </SmartLink>
          {entry.excerpt ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {entry.excerpt}
            </p>
          ) : null}
          <div
            className="news-richtext text-sm leading-relaxed text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          />
          {tagList.length ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {tagList.map((tag) => (
                <Badge key={tag} variant="secondary" className="uppercase tracking-[0.2rem]">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="pt-4">
            <SmartLink
              href={detailHref}
              className="text-xs uppercase tracking-[0.3rem] text-foreground underline decoration-2 underline-offset-4"
            >
              Read more
            </SmartLink>
          </div>
        </div>
      </div>
    </article>
  )
})

NewsCard.displayName = "NewsCard"

export default NewsCard
