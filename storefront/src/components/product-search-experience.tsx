"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Debouncer } from "@tanstack/pacer"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowDown01,
  ArrowUp10,
  Check,
  ChevronDown,
  Clock,
  Search,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import ProductCard from "@/components/product-card"
import type { ProductSearchHit, RelatedProductSummary } from "@/types/product"
import { cn } from "@/lib/ui/cn"
import { productSearchQueryOptions } from "@/lib/query/products"
import type { ProductSearchResponse } from "@/lib/search/search"

const mapHitToSummary = (hit: ProductSearchHit): RelatedProductSummary => ({
  id: hit.id,
  handle: hit.handle,
  title: hit.title,
  thumbnail: hit.thumbnail ?? null,
  collectionTitle: hit.collectionTitle ?? null,
  defaultVariant: hit.defaultVariant,
})

type SearchFacets = {
  genres: Record<string, number>
  format: Record<string, number>
}

type ProductSearchExperienceProps = {
  initialHits: ProductSearchHit[]
  initialFacets: SearchFacets
  initialTotal: number
  pageSize?: number
}

type SearchCriteria = {
  query: string
  genres: string[]
  formats: string[]
  limit: number
}

type SortOption = "featured" | "newest" | "price-low" | "price-high"

const SORT_OPTIONS: Array<{
  value: SortOption
  label: string
  helper: string
  Icon: LucideIcon
}> = [
  { value: "featured", label: "Featured", helper: "Staff picks & hype drops", Icon: Sparkles },
  { value: "newest", label: "Newest", helper: "Fresh rituals first", Icon: Clock },
  { value: "price-low", label: "Price · Low → High", helper: "Cheapest brutality", Icon: ArrowDown01 },
  { value: "price-high", label: "Price · High → Low", helper: "Premium torment", Icon: ArrowUp10 },
]

const sortResults = (results: ProductSearchHit[], sort: SortOption): ProductSearchHit[] => {
  if (sort === "featured") {
    return results
  }

  if (sort === "newest") {
    return [...results].sort((a, b) => {
      const aDate = new Date(a.createdAt ?? 0).getTime()
      const bDate = new Date(b.createdAt ?? 0).getTime()
      return bDate - aDate
    })
  }

  if (sort === "price-low") {
    return [...results].sort((a, b) => {
      const aPrice = a.priceAmount ?? Number.POSITIVE_INFINITY
      const bPrice = b.priceAmount ?? Number.POSITIVE_INFINITY
      return aPrice - bPrice
    })
  }

  if (sort === "price-high") {
    return [...results].sort((a, b) => {
      const aPrice = a.priceAmount ?? 0
      const bPrice = b.priceAmount ?? 0
      return bPrice - aPrice
    })
  }

  return results
}

const FilterSidebar = ({
  genres,
  formats,
  selectedGenres,
  selectedFormats,
  onToggleGenre,
  onToggleFormat,
  onClear,
  showInStockOnly,
  onToggleStock,
}: {
  genres: Array<[string, number]>
  formats: Array<[string, number]>
  selectedGenres: string[]
  selectedFormats: string[]
  onToggleGenre: (genre: string) => void
  onToggleFormat: (format: string) => void
  onClear: () => void
  showInStockOnly: boolean
  onToggleStock: () => void
}) => {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClear}
            className="text-xs uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-accent"
          >
            Reset
          </button>
        </div>
        <button
          type="button"
          onClick={onToggleStock}
          className={cn(
            "flex w-full items-center justify-between rounded-full border px-4 py-2 text-xs uppercase tracking-[0.3rem] transition",
            showInStockOnly
              ? "border-destructive/80 bg-destructive text-background shadow-glow"
              : "border-border/50 text-muted-foreground hover:border-destructive hover:text-destructive"
          )}
          aria-pressed={showInStockOnly}
        >
          <span>In stock only</span>
          <span
            className={cn(
              "inline-flex h-5 w-10 items-center rounded-full border border-border/60 bg-background px-1 transition",
              showInStockOnly && "justify-end border-destructive bg-destructive/40"
          )}
        >
          <span
            className={cn(
              "h-3.5 w-3.5 rounded-full bg-border transition",
              showInStockOnly && "bg-background"
            )}
          />
        </span>
        </button>
      </div>

      <div className="space-y-5">
        <details className="group space-y-3" open>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground">
            <span>Formats</span>
            <ChevronDown className="h-3 w-3 transition duration-200 group-open:rotate-180" />
          </summary>
          <div className="flex flex-wrap gap-2">
            {formats.length ? formats.map(([format, count]) => {
              const isActive = selectedFormats.includes(format)
              return (
                <button
                  key={`format-${format}`}
                  type="button"
                  onClick={() => onToggleFormat(format)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                    isActive
                      ? "border-destructive bg-destructive text-background shadow-glow-sm"
                      : "border-border/60 text-muted-foreground hover:border-destructive hover:text-destructive"
                  )}
                >
                  {format}
                  <span className="ml-1 text-[0.55rem] text-muted-foreground/80">({count})</span>
                </button>
              )
            }) : (
              <p className="text-xs text-muted-foreground">Formats coming soon.</p>
            )}
          </div>
        </details>

        <Separator className="border-border/50" />

        <details className="group space-y-3" open>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground">
            <span>Genres</span>
            <ChevronDown className="h-3 w-3 transition duration-200 group-open:rotate-180" />
          </summary>
          <div className="flex flex-wrap gap-2">
            {genres.length ? genres.map(([genre, count]) => {
              const isActive = selectedGenres.includes(genre)
              return (
                <button
                  key={`genre-${genre}`}
                  type="button"
                  onClick={() => onToggleGenre(genre)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                    isActive
                      ? "border-destructive bg-destructive text-background shadow-glow-sm"
                      : "border-border/60 text-muted-foreground hover:border-destructive hover:text-destructive"
                  )}
                >
                  {genre}
                  <span className="ml-1 text-[0.55rem] text-muted-foreground/80">({count})</span>
                </button>
              )
            }) : (
              <p className="text-xs text-muted-foreground">Genres appear as catalog grows.</p>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}

const SortDropdown = ({
  value,
  onChange,
}: {
  value: SortOption
  onChange: (value: SortOption) => void
}) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeOption = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0]

  useEffect(() => {
    const handleClick = (event: globalThis.MouseEvent) => {
      if (!containerRef.current) {
        return
      }
      if (!(event.target instanceof Node)) {
        return
      }
      if (!containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKeydown)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKeydown)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-11 min-w-[220px] items-center justify-between rounded-full border border-border/40 bg-background/80 px-4 text-left text-xs uppercase tracking-[0.3rem] text-foreground transition supports-[backdrop-filter]:backdrop-blur-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive",
          open && "border-destructive/60"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[0.65rem]">
          <activeOption.Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {activeOption.label}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition duration-200",
            open && "-scale-y-100"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.35rem)] z-40 min-w-[260px] rounded-3xl border border-border/50 bg-background/95 p-1.5 shadow-glow supports-[backdrop-filter]:backdrop-blur-2xl">
          <div role="listbox" className="flex flex-col gap-1">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-left text-[0.7rem] uppercase tracking-[0.25rem] text-muted-foreground/90 transition hover:border-destructive/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive",
                  value === option.value && "border-destructive bg-destructive text-background shadow-glow-sm"
                )}
                role="option"
                aria-selected={value === option.value}
              >
                <span className="flex flex-col">
                  <span className={cn("flex items-center gap-2 font-semibold", value === option.value ? "text-background" : "text-foreground")}>
                    <option.Icon className="h-4 w-4" aria-hidden />
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "text-[0.55rem] uppercase tracking-[0.3rem]",
                      value === option.value ? "text-background/80" : "text-muted-foreground"
                    )}
                  >
                    {option.helper}
                  </span>
                </span>
                {value === option.value ? (
                  <Check className="h-4 w-4 text-background" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const ProductSearchExperience = ({
  initialHits,
  initialFacets,
  initialTotal,
  pageSize = 24,
}: ProductSearchExperienceProps) => {
  const [query, setQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [selectedFormats, setSelectedFormats] = useState<string[]>([])
  const [showInStockOnly, setShowInStockOnly] = useState(false)
  const [sortOption, setSortOption] = useState<SortOption>("featured")
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [criteria, setCriteria] = useState<SearchCriteria>({
    query: "",
    genres: [],
    formats: [],
    limit: pageSize,
  })

  const debouncerRef = useRef<Debouncer<(job: SearchCriteria) => void> | null>(null)

  useEffect(() => {
    const debouncer = new Debouncer((job: SearchCriteria) => {
      setCriteria(job)
    }, { wait: 220 })

    debouncerRef.current = debouncer

    return () => {
      debouncer.cancel()
      debouncerRef.current = null
    }
  }, [])

  useEffect(() => {
    debouncerRef.current?.maybeExecute({
      query,
      genres: selectedGenres,
      formats: selectedFormats,
      limit: pageSize,
    })
  }, [query, selectedGenres, selectedFormats, pageSize])


  const initialResult = useMemo<ProductSearchResponse>(() => ({
    hits: initialHits,
    facets: initialFacets,
    total: initialTotal,
  }), [initialHits, initialFacets, initialTotal])

  const {
    data,
    isFetching,
    isError,
    error,
  } = useQuery({
    ...productSearchQueryOptions(criteria),
    initialData: initialResult,
    placeholderData: (previous) => previous ?? initialResult,
  })

  useEffect(() => {
    if (isError) {
      console.error("Catalog search failed", error)
      toast.error("Unable to load search results. Please try again.")
    }
  }, [isError, error])

  const facets = data?.facets ?? initialFacets
  const baseHits = data?.hits ?? initialHits

  const availabilityFilteredHits = useMemo(() => {
    if (!showInStockOnly) {
      return baseHits
    }
    return baseHits.filter((hit) => {
      const status = hit.stockStatus ?? (hit.defaultVariant?.inStock ? "in_stock" : "sold_out")
      return status !== "sold_out"
    })
  }, [baseHits, showInStockOnly])

  const sortedHits = useMemo(
    () => sortResults(availabilityFilteredHits, sortOption),
    [availabilityFilteredHits, sortOption]
  )

  const mappedResults = useMemo(
    () => sortedHits.map((hit) => mapHitToSummary(hit)),
    [sortedHits]
  )

  const totalResults = mappedResults.length
  const activeFiltersCount = useMemo(
    () => selectedGenres.length + selectedFormats.length + (showInStockOnly ? 1 : 0),
    [selectedGenres.length, selectedFormats.length, showInStockOnly]
  )

  const sortedGenreFacets = useMemo(
    () =>
      Object.entries(facets.genres ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16),
    [facets.genres]
  )

  const sortedFormatFacets = useMemo(
    () =>
      Object.entries(facets.format ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16),
    [facets.format]
  )

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
    setShowInStockOnly(false)
  }

  return (
    <div className="bg-background pb-16">
      <div className="container flex flex-col gap-6 px-2 py-8 sm:px-4 lg:flex-row lg:gap-8">
        <aside className="hidden lg:block lg:w-56 lg:flex-shrink-0">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto bg-background/90 px-4 py-5 supports-[backdrop-filter]:backdrop-blur-xl">
            <FilterSidebar
              genres={sortedGenreFacets}
              formats={sortedFormatFacets}
              selectedGenres={selectedGenres}
              selectedFormats={selectedFormats}
              onToggleGenre={toggleGenre}
              onToggleFormat={toggleFormat}
              onClear={clearFilters}
              showInStockOnly={showInStockOnly}
              onToggleStock={() => setShowInStockOnly((value) => !value)}
            />
          </div>
        </aside>

        <div className="flex-1 space-y-6">
          <header className="relative sticky top-16 z-20 space-y-2 border-b border-border/40 bg-background/80 px-2 py-3 supports-[backdrop-filter]:backdrop-blur-lg sm:px-4 lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                {isFetching ? "Refreshing…" : `${totalResults} results`}
              </p>
              <p className="hidden text-[0.65rem] uppercase tracking-[0.35rem] text-muted-foreground/80 sm:block">
                Tuned in · Brutalized
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="lg:hidden">
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="inline-flex h-11 items-center gap-2 rounded-full border-border/50 px-4 text-xs uppercase tracking-[0.3rem]"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[min(92vw,300px)] p-0">
                    <SheetHeader className="px-6 pb-4 pt-6 text-left">
                      <SheetTitle className="text-lg uppercase tracking-[0.3rem]">
                        Filters
                      </SheetTitle>
                    </SheetHeader>
                    <div className="h-[calc(100vh-6.5rem)] overflow-y-auto px-6 pb-10">
                      <FilterSidebar
                        genres={sortedGenreFacets}
                        formats={sortedFormatFacets}
                        selectedGenres={selectedGenres}
                        selectedFormats={selectedFormats}
                        onToggleGenre={toggleGenre}
                        onToggleFormat={toggleFormat}
                        onClear={() => {
                          clearFilters()
                          setMobileFiltersOpen(false)
                        }}
                        showInStockOnly={showInStockOnly}
                        onToggleStock={() => setShowInStockOnly((value) => !value)}
                      />
                      <div className="mt-8">
                        <SheetClose asChild>
                          <Button variant="outline" className="w-full">
                            Done
                          </Button>
                        </SheetClose>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
              <div className="group flex h-11 min-w-[240px] flex-1 items-center gap-2 rounded-full border border-border/40 bg-background/85 px-3 py-2 transition supports-[backdrop-filter]:backdrop-blur-lg focus-within:border-destructive focus-within:shadow-glow-sm">
                <Search className="h-4 w-4 text-muted-foreground transition group-focus-within:text-destructive" aria-hidden />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Seek brutality…"
                  className="h-9 flex-1 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:border-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  type="search"
                  autoComplete="off"
                />
              </div>
              <SortDropdown value={sortOption} onChange={(option) => setSortOption(option)} />
            </div>

            {(query || selectedGenres.length || selectedFormats.length || showInStockOnly) && (
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="rounded-full border border-destructive/60 bg-destructive/10 px-3 py-1 text-foreground transition hover:border-destructive hover:text-destructive"
                  >
                    Query: <span className="ml-1 text-accent">{query}</span> ✕
                  </button>
                ) : null}
                {selectedFormats.map((format) => (
                  <button
                    key={`active-format-${format}`}
                    type="button"
                    onClick={() => toggleFormat(format)}
                    className="rounded-full border border-destructive bg-destructive px-3 py-1 text-background transition hover:opacity-90"
                  >
                    {format} ✕
                  </button>
                ))}
                {selectedGenres.map((genre) => (
                  <button
                    key={`active-genre-${genre}`}
                    type="button"
                    onClick={() => toggleGenre(genre)}
                    className="rounded-full border border-destructive bg-destructive px-3 py-1 text-background transition hover:opacity-90"
                  >
                    {genre} ✕
                  </button>
                ))}
                {showInStockOnly ? (
                  <button
                    type="button"
                    onClick={() => setShowInStockOnly(false)}
                    className="rounded-full border border-destructive bg-destructive px-3 py-1 text-background transition hover:opacity-90"
                  >
                    In stock ✕
                  </button>
                ) : null}
              </div>
            )}

          </header>

          <section className="space-y-6 px-2 pt-4 sm:px-4 lg:px-6">
            {isFetching ? (
              <div className="text-sm uppercase tracking-[0.3rem] text-muted-foreground">
                Refreshing results…
              </div>
            ) : null}

            {mappedResults.length ? (
              <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                {mappedResults.map((product, index) => (
                  <ProductCard
                    key={`${product.id}-${product.handle ?? product.id}-${index}`}
                    product={product}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-background/80 p-12 text-center text-sm text-muted-foreground">
                <p>No results matched that combination.</p>
                <p>Try relaxing a filter or using a broader search term.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default ProductSearchExperience
