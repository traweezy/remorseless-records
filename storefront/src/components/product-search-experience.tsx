"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"

import { Debouncer } from "@tanstack/pacer"
import { toast } from "sonner"

import { searchProductsBrowser } from "@/lib/search/browser"
import type { FacetMap } from "@/lib/search/normalize"
import type {
  ProductSearchHit,
  RelatedProductSummary,
} from "@/types/product"
import { cn } from "@/lib/ui/cn"
import RelatedProductCard from "@/components/related-product-card"

type SearchFacets = {
  genres: FacetMap
  format: FacetMap
}

type ProductSearchExperienceProps = {
  initialHits: ProductSearchHit[]
  initialFacets: SearchFacets
  initialTotal: number
}

type SearchJob = {
  query: string
  genres: string[]
  formats: string[]
}

const mapHitToSummary = (hit: ProductSearchHit): RelatedProductSummary => ({
  id: hit.id,
  handle: hit.handle,
  title: hit.title,
  thumbnail: hit.thumbnail ?? null,
  collectionTitle: hit.collectionTitle ?? null,
  defaultVariant: hit.defaultVariant,
})

const ProductSearchExperience = ({
  initialHits,
  initialFacets,
  initialTotal,
}: ProductSearchExperienceProps) => {
  const [query, setQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [results, setResults] = useState<ProductSearchHit[]>(initialHits)
  const [facets, setFacets] = useState<SearchFacets>(initialFacets)
  const [total, setTotal] = useState(initialTotal)
  const [isPending, startTransition] = useTransition()

  const latestJobRef = useRef<SearchJob>({
    query: "",
    genres: [],
    formats: [],
  })

  const runSearch = useCallback(async (job: SearchJob) => {
    latestJobRef.current = job
    try {
      const response = await searchProductsBrowser({
        query: job.query,
        limit: 24,
        filters: {
          genres: job.genres,
          formats: job.formats,
        },
      })

      startTransition(() => {
        setResults(response.hits)
        setFacets(response.facets)
        setTotal(response.total)
      })
    } catch (error) {
      console.error(error)
      toast.error("Unable to load search results. Please try again.")
    }
  }, [startTransition])

  const debouncerRef = useRef<Debouncer<(job: SearchJob) => void> | null>(null)

  useEffect(() => {
    const debouncer = new Debouncer((job: SearchJob) => {
      void runSearch(job)
    }, { wait: 220 })

    debouncerRef.current = debouncer

    return () => {
      debouncer.cancel()
      debouncerRef.current = null
    }
  }, [runSearch])

  const scheduleSearch = useCallback(
    (job: SearchJob) => {
      debouncerRef.current?.maybeExecute(job)
    },
    []
  )

  const hasInitialized = useRef(false)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true
      return
    }

    scheduleSearch({
      query,
      genres: selectedGenres,
      formats: selectedFormats,
    })
  }, [query, selectedGenres, selectedFormats, scheduleSearch])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre)
        ? prev.filter((value) => value !== genre)
        : [...prev, genre]
    )
  }

  const toggleFormat = (format: string) => {
    setSelectedFormats((prev) =>
      prev.includes(format)
        ? prev.filter((value) => value !== format)
        : [...prev, format]
    )
  }

  const clearFilters = () => {
    setSelectedGenres([])
    setSelectedFormats([])
  }

  const hasFilters = selectedGenres.length > 0 || selectedFormats.length > 0

  const sortedGenreFacets = useMemo(
    () =>
      Object.entries(facets.genres)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    [facets.genres]
  )

  const sortedFormatFacets = useMemo(
    () =>
      Object.entries(facets.format)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    [facets.format]
  )

  const mappedResults = useMemo(
    () => results.map(mapHitToSummary),
    [results]
  )

  return (
    <div className="grid gap-10 lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-6 rounded-2xl border border-border/60 bg-surface/70 p-6 shadow-elegant">
        <div className="space-y-3">
          <label
            htmlFor="search-input"
            className="font-headline text-xs uppercase tracking-[0.4rem] text-muted-foreground"
          >
            Search Catalog
          </label>
          <div className="relative">
            <input
              id="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Seek brutality..."
              className="w-full rounded-full border border-border/60 bg-background px-4 py-2.5 text-sm text-foreground shadow-inner focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              type="search"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-accent"
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Instant results powered by Meilisearch. Select genres and formats to
            refine the assault.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3rem] text-muted-foreground">
            <span>Genres</span>
            {selectedGenres.length ? (
              <span className="text-foreground">{selectedGenres.length}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sortedGenreFacets.map(([genre, count]) => {
              const isActive = selectedGenres.includes(genre)
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                    isActive
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border/60 text-muted-foreground hover:border-accent hover:text-accent"
                  )}
                >
                  {genre} <span className="ml-1 text-[0.55rem] text-muted-foreground/80">({count})</span>
                </button>
              )
            })}
            {!sortedGenreFacets.length ? (
              <p className="text-xs text-muted-foreground">
                No genre facets available yet.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3rem] text-muted-foreground">
            <span>Formats</span>
            {selectedFormats.length ? (
              <span className="text-foreground">
                {selectedFormats.length}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {sortedFormatFacets.map(([format, count]) => {
              const isActive = selectedFormats.includes(format)
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => toggleFormat(format)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                    isActive
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border/60 text-muted-foreground hover:border-accent hover:text-accent"
                  )}
                >
                  {format}{" "}
                  <span className="ml-1 text-[0.55rem] text-muted-foreground/80">
                    ({count})
                  </span>
                </button>
              )
            })}
            {!sortedFormatFacets.length ? (
              <p className="text-xs text-muted-foreground">
                Format facets will appear as products sync.
              </p>
            ) : null}
          </div>
        </div>

        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="self-start rounded-full border border-border/60 px-4 py-1 text-[0.6rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            Reset filters
          </button>
        ) : null}
      </aside>

      <section className="space-y-6">
        <div className="flex flex-col gap-3">
          <div
            aria-live="polite"
            className="font-headline text-sm uppercase tracking-[0.3rem] text-muted-foreground"
          >
            {isPending ? "Searching…" : `Showing ${total} releases`}
          </div>
          {hasFilters || query ? (
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
              {query ? (
                <span className="rounded-full border border-border/60 px-3 py-1">
                  Query: <span className="text-foreground">{query}</span>
                </span>
              ) : null}
              {selectedGenres.map((genre) => (
                <button
                  key={`genre-${genre}`}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  className="rounded-full border border-accent/60 px-3 py-1 text-accent transition hover:bg-accent hover:text-background"
                >
                  {genre} ✕
                </button>
              ))}
              {selectedFormats.map((format) => (
                <button
                  key={`format-${format}`}
                  type="button"
                  onClick={() => toggleFormat(format)}
                  className="rounded-full border border-accent/60 px-3 py-1 text-accent transition hover:bg-accent hover:text-background"
                >
                  {format} ✕
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {mappedResults.length ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {mappedResults.map((product) => (
              <RelatedProductCard key={`${product.id}-${product.handle}`} product={product} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-surface/80 p-12 text-center text-sm text-muted-foreground">
            <p>No results matched that combination.</p>
            <p>Try relaxing a filter or using a broader search term.</p>
          </div>
        )}
      </section>
    </div>
  )
}

export default ProductSearchExperience
