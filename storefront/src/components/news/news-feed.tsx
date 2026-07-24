"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import NewsCard from "@/components/news/news-card"
import { NewsCardSkeleton } from "@/components/news/news-card-skeleton"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription } from "@/components/ui/empty"
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
          <NewsCardSkeleton key={`news-skeleton-${index}`} />
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
        <Empty className="rounded-3xl border-border/50 bg-muted/10 p-10">
          <EmptyDescription>
            No news entries yet. Check back soon for new releases and updates.
          </EmptyDescription>
        </Empty>
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
          <Alert variant="destructive" className="p-4 text-destructive">
            {error}
          </Alert>
        ) : null}
        <div ref={sentinelRef} />
        {!canAutoLoad && hasMore ? (
          <Button
            type="button"
            variant="outlined"
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
