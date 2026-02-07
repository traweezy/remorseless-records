"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import NewsCard from "@/components/news/news-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { NEWS_PAGE_SIZE, type NewsEntry } from "@/lib/data/news"

type NewsFeedProps = {
  initialEntries: NewsEntry[]
  totalCount: number
  pageSize?: number
}

type NewsFeedResponse = {
  entries: NewsEntry[]
  count: number
}

const NewsFeed = memo<NewsFeedProps>(
  ({ initialEntries, totalCount, pageSize = NEWS_PAGE_SIZE }) => {
    const [entries, setEntries] = useState<NewsEntry[]>(initialEntries)
    const [offset, setOffset] = useState(initialEntries.length)
    const [total, setTotal] = useState(totalCount)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [canAutoLoad, setCanAutoLoad] = useState(false)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    const hasMore = offset < total

    useEffect(() => {
      setEntries(initialEntries)
      setOffset(initialEntries.length)
      setTotal(totalCount)
    }, [initialEntries, totalCount])

    useEffect(() => {
      setCanAutoLoad(
        typeof window !== "undefined" && "IntersectionObserver" in window
      )
    }, [])

    const fetchMore = useCallback(async () => {
      if (loading || !hasMore) {
        return
      }

      setLoading(true)
      setError(null)

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 10000)

      try {
        const url = new URL("/api/news", window.location.origin)
        url.searchParams.set("limit", String(pageSize))
        url.searchParams.set("offset", String(offset))

        const response = await fetch(url.toString(), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to load news (${response.status})`)
        }

        const payload = (await response.json()) as NewsFeedResponse
        const nextEntries = payload.entries ?? []
        const nextOffset = offset + nextEntries.length
        const nextTotal =
          typeof payload.count === "number" ? payload.count : total

        setEntries((prev) => [...prev, ...nextEntries])
        setOffset(nextOffset)
        setTotal(nextTotal)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load news")
      } finally {
        window.clearTimeout(timeout)
        setLoading(false)
      }
    }, [hasMore, loading, offset, pageSize, total])

    const handleIntersect = useCallback(
      (observed: IntersectionObserverEntry[]) => {
        if (!observed.some((entry) => entry.isIntersecting)) {
          return
        }
        void fetchMore()
      },
      [fetchMore]
    )

    useEffect(() => {
      const node = sentinelRef.current
      if (!node || !canAutoLoad || !hasMore) {
        return
      }

      const observer = new IntersectionObserver(handleIntersect, {
        rootMargin: "200px",
      })
      observer.observe(node)

      return () => observer.disconnect()
    }, [canAutoLoad, handleIntersect, hasMore])

    const skeletons = useMemo(
      () =>
        Array.from({ length: 2 }, (_, index) => (
          <div
            key={`news-skeleton-${index}`}
            className="rounded-3xl border border-border/40 bg-muted/5 p-5 md:p-8"
          >
            <div className="flex flex-col gap-6 md:flex-row md:gap-10">
              <Skeleton className="aspect-[4/3] w-full rounded-2xl md:w-5/12" />
              <div className="flex flex-1 flex-col gap-4">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        )),
      []
    )

    const renderedCards = useMemo(
      () =>
        entries.map((entry, index) => (
          <NewsCard key={entry.id} entry={entry} index={index} />
        )),
      [entries]
    )

    const emptyState = useMemo(() => {
      if (entries.length || loading) {
        return null
      }

      return (
        <div className="rounded-3xl border border-border/50 bg-muted/10 p-10 text-center text-sm text-muted-foreground">
          No news entries yet. Check back soon for new releases and updates.
        </div>
      )
    }, [entries.length, loading])

    const handleManualLoad = useCallback(() => {
      void fetchMore()
    }, [fetchMore])

    return (
      <div className="flex flex-col gap-8">
        {renderedCards}
        {loading ? skeletons : null}
        {emptyState}
        {error ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div ref={sentinelRef} />
        {!canAutoLoad && hasMore ? (
          <Button
            type="button"
            variant="outline"
            className="self-center"
            onClick={handleManualLoad}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more"}
          </Button>
        ) : null}
      </div>
    )
  }
)

NewsFeed.displayName = "NewsFeed"

export default NewsFeed
