"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Debouncer } from "@tanstack/pacer"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowUp10,
  Check,
  ChevronDown,
  Clock,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react"
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
import { humanizeCategoryHandle } from "@/lib/products/categories"
import { cn } from "@/lib/ui/cn"
import { searchProductsBrowser } from "@/lib/search/browser"
import type {
  ProductSearchResponse,
  ProductSortOption,
} from "@/lib/search/search"

const mapHitToSummary = (hit: ProductSearchHit): RelatedProductSummary => ({
  id: hit.id,
  handle: hit.handle,
  title: hit.title,
  artist: hit.artist,
  album: hit.album,
  slug: hit.slug,
  subtitle: hit.subtitle ?? null,
  thumbnail: hit.thumbnail ?? null,
  collectionTitle: hit.collectionTitle ?? null,
  defaultVariant: hit.defaultVariant,
})

type SearchFacets = {
  genres: Record<string, number>
  format: Record<string, number>
  categories: Record<string, number>
  variants: Record<string, number>
}

type ProductSearchExperienceProps = {
  initialHits: ProductSearchHit[]
  initialFacets: SearchFacets
  initialTotal: number
  initialOffset?: number
  pageSize?: number
  initialSort?: ProductSortOption
}

type SearchCriteria = {
  query: string
  genres: string[]
  categories: string[]
  variants: string[]
  limit: number
  inStockOnly: boolean
}

const SORT_OPTIONS: Array<{
  value: ProductSortOption
  label: string
  helper: string
  Icon: LucideIcon
}> = [
  {
    value: "alphabetical",
    label: "Alphabetical",
    helper: "Name · A → Z",
    Icon: ArrowDownAZ,
  },
  {
    value: "newest",
    label: "Newest",
    helper: "Fresh rituals first",
    Icon: Clock,
  },
  {
    value: "price-low",
    label: "Price · Low → High",
    helper: "Cheapest brutality",
    Icon: ArrowDown01,
  },
  {
    value: "price-high",
    label: "Price · High → Low",
    helper: "Premium torment",
    Icon: ArrowUp10,
  },
]

const alphabeticalCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
})

const sortResults = (
  results: ProductSearchHit[],
  sort: ProductSortOption
): ProductSearchHit[] => {
  if (sort === "alphabetical") {
    return [...results].sort((a, b) =>
      alphabeticalCollator.compare(
        `${a.artist ?? ""} ${a.album ?? ""}`,
        `${b.artist ?? ""} ${b.album ?? ""}`
      )
    )
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
  variants,
  categories,
  selectedGenres,
  selectedVariants,
  selectedCategories,
  onToggleGenre,
  onToggleVariant,
  onToggleCategory,
  onClear,
  showInStockOnly,
  onToggleStock,
}: {
  genres: Array<[string, number]>
  variants: Array<[string, number]>
  categories: Array<[string, number]>
  selectedGenres: string[]
  selectedVariants: string[]
  selectedCategories: string[]
  onToggleGenre: (genre: string) => void
  onToggleVariant: (variant: string) => void
  onToggleCategory: (category: string) => void
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
            <span>Categories</span>
            <ChevronDown className="h-3 w-3 transition duration-200 group-open:rotate-180" />
          </summary>
          <div className="flex flex-wrap gap-2">
            {categories.length ? (
              categories.map(([handle, count]) => {
                const isActive = selectedCategories.includes(handle)
                const label = humanizeCategoryHandle(handle)
                return (
                  <button
                    key={`category-${handle}`}
                    type="button"
                    onClick={() => onToggleCategory(handle)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                      isActive
                        ? "border-destructive bg-destructive text-background shadow-glow-sm"
                        : "border-border/60 text-muted-foreground hover:border-destructive hover:text-destructive"
                    )}
                  >
                    {label}
                    <span className="ml-1 text-[0.55rem] text-muted-foreground/80">
                      ({count})
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">
                Categories coming soon.
              </p>
            )}
          </div>
        </details>

        <Separator className="border-border/50" />

        <details className="group space-y-3" open>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold uppercase tracking-[0.3rem] text-muted-foreground">
            <span>Variants</span>
            <ChevronDown className="h-3 w-3 transition duration-200 group-open:rotate-180" />
          </summary>
          <div className="flex flex-wrap gap-2">
            {variants.length ? (
              variants.map(([variant, count]) => {
                const isActive = selectedVariants.includes(variant)
                return (
                  <button
                    key={`variant-${variant}`}
                    type="button"
                    onClick={() => onToggleVariant(variant)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[0.6rem] uppercase tracking-[0.3rem] transition",
                      isActive
                        ? "border-destructive bg-destructive text-background shadow-glow-sm"
                        : "border-border/60 text-muted-foreground hover:border-destructive hover:text-destructive"
                    )}
                  >
                    {variant}
                    <span className="ml-1 text-[0.55rem] text-muted-foreground/80">
                      ({count})
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">
                Variants coming soon.
              </p>
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
            {genres.length ? (
              genres.map(([genre, count]) => {
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
                    <span className="ml-1 text-[0.55rem] text-muted-foreground/80">
                      ({count})
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="text-xs text-muted-foreground">
                Genres appear as catalog grows.
              </p>
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
  value: ProductSortOption
  onChange: (value: ProductSortOption) => void
}) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fallbackOption = SORT_OPTIONS[0]
  if (!fallbackOption) {
    throw new Error("SORT_OPTIONS must contain at least one entry")
  }

  const activeOption =
    SORT_OPTIONS.find((option) => option.value === value) ?? fallbackOption

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
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
    const handleKeydown = (event: KeyboardEvent) => {
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
                  value === option.value &&
                    "border-destructive bg-destructive text-background shadow-glow-sm"
                )}
                role="option"
                aria-selected={value === option.value}
              >
                <span className="flex flex-col">
                  <span
                    className={cn(
                      "flex items-center gap-2 font-semibold",
                      value === option.value
                        ? "text-background"
                        : "text-foreground"
                    )}
                  >
                    <option.Icon className="h-4 w-4" aria-hidden />
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "text-[0.55rem] uppercase tracking-[0.3rem]",
                      value === option.value
                        ? "text-background/80"
                        : "text-muted-foreground"
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

const ProductCardSkeleton = () => (
  <div className="flex h-full flex-col rounded-2xl border border-border/40 bg-background/60 p-4">
    <div className="aspect-square w-full animate-pulse rounded-xl bg-border/40" />
    <div className="mt-4 space-y-3">
      <div className="h-4 w-3/4 animate-pulse rounded-full bg-border/40" />
      <div className="h-3 w-1/2 animate-pulse rounded-full bg-border/30" />
      <div className="h-3 w-1/3 animate-pulse rounded-full bg-border/20" />
    </div>
  </div>
)

const useWindowVirtualizerCompat = (
  options: Parameters<typeof useWindowVirtualizer>[0]
) => {
  "use no memo"
  return useWindowVirtualizer(options)
}

const useResponsiveColumns = () => {
  const [columns, setColumns] = useState(1)

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth
      if (width >= 1536) {
        setColumns(4)
      } else if (width >= 1024) {
        setColumns(3)
      } else if (width >= 640) {
        setColumns(2)
      } else {
        setColumns(1)
      }
    }

    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  return columns
}

const ProductSearchExperience = ({
  initialHits,
  initialFacets,
  initialTotal,
  initialOffset = 0,
  pageSize = 24,
  initialSort = "alphabetical",
}: ProductSearchExperienceProps) => {
  const [query, setQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedVariants, setSelectedVariants] = useState<string[]>([])
  const [showInStockOnly, setShowInStockOnly] = useState(false)
  const [sortOption, setSortOption] = useState<ProductSortOption>(initialSort)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [criteria, setCriteria] = useState<SearchCriteria>({
    query: "",
    genres: [],
    categories: [],
    variants: [],
    limit: pageSize,
    inStockOnly: false,
  })

  const debouncerRef =
    useRef<Debouncer<(job: SearchCriteria) => void> | null>(null)

  useEffect(() => {
    const debouncer = new Debouncer<(job: SearchCriteria) => void>(
      (job: SearchCriteria) => {
        setCriteria(job)
      },
      { wait: 220 }
    )

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
      categories: selectedCategories,
      variants: selectedVariants,
      limit: pageSize,
      inStockOnly: showInStockOnly,
    })
  }, [
    query,
    selectedGenres,
    selectedCategories,
    selectedVariants,
    showInStockOnly,
    pageSize,
  ])

  const genresKey = useMemo(
    () => [...criteria.genres].sort().join("|"),
    [criteria.genres]
  )
  const categoriesKey = useMemo(
    () => [...criteria.categories].sort().join("|"),
    [criteria.categories]
  )
  const variantsKey = useMemo(
    () => [...criteria.variants].sort().join("|"),
    [criteria.variants]
  )

  const initialResult = useMemo<ProductSearchResponse>(
    () => ({
      hits: initialHits,
      total: initialTotal,
      offset: initialOffset,
      facets: initialFacets,
    }),
    [initialHits, initialTotal, initialOffset, initialFacets]
  )

  const initialQueryData = useMemo(
    () => ({
      pages: [initialResult],
      pageParams: [initialOffset],
    }),
    [initialResult, initialOffset]
  )

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "catalog-search",
      criteria.query.trim(),
      genresKey,
      categoriesKey,
      variantsKey,
      criteria.limit,
      sortOption,
      criteria.inStockOnly ? "in-stock" : "all",
    ],
    queryFn: async ({ pageParam = 0 }) =>
      searchProductsBrowser({
        query: criteria.query,
        limit: criteria.limit,
        offset: pageParam,
        filters: {
          genres: criteria.genres,
          categories: criteria.categories,
          variants: criteria.variants,
        },
        sort: sortOption,
        inStockOnly: criteria.inStockOnly,
      }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.hits.length, 0)
      if (loaded >= lastPage.total) {
        return undefined
      }
      return loaded
    },
    initialPageParam: 0,
    initialData: initialQueryData,
    placeholderData: (previous) => previous ?? initialQueryData,
  })

  const pages = data?.pages ?? initialQueryData.pages
  const facets = pages[0]?.facets ?? initialFacets
  const totalResults = pages[0]?.total ?? 0

  const aggregatedHits = useMemo(
    () => pages.flatMap((page) => page.hits),
    [pages]
  )

  const sortedHits = useMemo(
    () => sortResults(aggregatedHits, sortOption),
    [aggregatedHits, sortOption]
  )

  const mappedResults = useMemo(
    () => sortedHits.map(mapHitToSummary),
    [sortedHits]
  )

  const columns = useResponsiveColumns()
  const rowEstimate = useMemo(() => {
    if (columns >= 4) return 420
    if (columns === 3) return 440
    if (columns === 2) return 460
    return 520
  }, [columns])

  const totalRowCount =
    columns > 0 ? Math.max(Math.ceil(totalResults / columns), 1) : 1

  const virtualizer = useWindowVirtualizerCompat({
    count: totalRowCount,
    estimateSize: () => rowEstimate,
    overscan: 8,
    scrollMargin: 180,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    virtualizer.measure()
  }, [columns, rowEstimate, virtualizer])

  useEffect(() => {
    if (!virtualItems.length || !hasNextPage) {
      return
    }

    const lastVirtualRow = virtualItems[virtualItems.length - 1]
    if (!lastVirtualRow) {
      return
    }
    const neededItems = Math.min(
      totalResults,
      (lastVirtualRow.index + 1) * columns
    )

    if (
      neededItems > aggregatedHits.length &&
      !isFetchingNextPage &&
      hasNextPage
    ) {
      void fetchNextPage()
    }
  }, [
    virtualItems,
    columns,
    totalResults,
    aggregatedHits.length,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  ])

  const criteriaKey = useMemo(
    () =>
      [
        criteria.query.trim(),
        genresKey,
        categoriesKey,
        variantsKey,
        criteria.inStockOnly ? "in-stock" : "all",
        sortOption,
      ].join("|"),
    [criteria.query, genresKey, categoriesKey, variantsKey, criteria.inStockOnly, sortOption]
  )

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.scrollTo({ top: 0 })
    virtualizer.scrollToIndex(0, { align: "start" })
  }, [criteriaKey, virtualizer])

  const totalResultsCopy = mappedResults.length
  const activeFiltersCount =
    selectedGenres.length +
    selectedCategories.length +
    selectedVariants.length +
    (showInStockOnly ? 1 : 0) +
    (query ? 1 : 0)

  const sortedGenreFacets = useMemo(
    () =>
      Object.entries(facets.genres ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16),
    [facets.genres]
  )

  const sortedCategoryFacets = useMemo(
    () =>
      Object.entries(facets.categories ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
    [facets.categories]
  )

  const sortedVariantFacets = useMemo(
    () =>
      Object.entries(facets.variants ?? facets.format ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16),
    [facets.variants, facets.format]
  )

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre)
        ? prev.filter((value) => value !== genre)
        : [...prev, genre]
    )
  }

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((value) => value !== category)
        : [...prev, category]
    )
  }

  const toggleVariant = (variant: string) => {
    setSelectedVariants((prev) =>
      prev.includes(variant)
        ? prev.filter((value) => value !== variant)
        : [...prev, variant]
    )
  }

  const clearFilters = () => {
    setSelectedGenres([])
    setSelectedCategories([])
    setSelectedVariants([])
    setShowInStockOnly(false)
  }

  const gridTemplateStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    }),
    [columns]
  )

  return (
    <div className="bg-background pb-16">
      <div className="container flex flex-col gap-6 px-2 py-8 sm:px-4 lg:flex-row lg:gap-8">
        <aside className="hidden lg:block lg:w-56 lg:flex-shrink-0">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto bg-background/90 px-4 py-5 supports-[backdrop-filter]:backdrop-blur-xl">
            <FilterSidebar
              genres={sortedGenreFacets}
              variants={sortedVariantFacets}
              categories={sortedCategoryFacets}
              selectedGenres={selectedGenres}
              selectedVariants={selectedVariants}
              selectedCategories={selectedCategories}
              onToggleGenre={toggleGenre}
              onToggleVariant={toggleVariant}
              onToggleCategory={toggleCategory}
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
                        variants={sortedVariantFacets}
                        categories={sortedCategoryFacets}
                        selectedGenres={selectedGenres}
                        selectedVariants={selectedVariants}
                        selectedCategories={selectedCategories}
                        onToggleGenre={toggleGenre}
                        onToggleVariant={toggleVariant}
                        onToggleCategory={toggleCategory}
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
                <Search
                  className="h-4 w-4 text-muted-foreground transition group-focus-within:text-destructive"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Seek brutality…"
                  className="h-9 flex-1 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:border-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  type="search"
                  autoComplete="off"
                />
              </div>
              <SortDropdown value={sortOption} onChange={setSortOption} />
            </div>

            {(query ||
              selectedGenres.length ||
              selectedCategories.length ||
              selectedVariants.length ||
              showInStockOnly) && (
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
                {selectedCategories.map((category) => (
                  <button
                    key={`active-category-${category}`}
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className="rounded-full border border-destructive bg-destructive px-3 py-1 text-background transition hover:opacity-90"
                  >
                    {humanizeCategoryHandle(category)} ✕
                  </button>
                ))}
                {selectedVariants.map((variant) => (
                  <button
                    key={`active-variant-${variant}`}
                    type="button"
                    onClick={() => toggleVariant(variant)}
                    className="rounded-full border border-destructive bg-destructive px-3 py-1 text-background transition hover:opacity-90"
                  >
                    {variant} ✕
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

          <section className="space-y-4 px-2 sm:px-4 lg:px-6">
            {isFetching && !isFetchingNextPage ? (
              <div className="text-sm uppercase tracking-[0.3rem] text-muted-foreground">
                Refreshing results…
              </div>
            ) : null}

            {totalResultsCopy ? (
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualItems.map((virtualRow) => {
                  const rowIndex = virtualRow.index
                  const startIndex = rowIndex * columns

                  return (
                    <div
                      key={virtualRow.index}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                        paddingBottom: columns > 2 ? 16 : 12,
                      }}
                    >
                      <div
                        className="grid gap-6"
                        style={gridTemplateStyle}
                      >
                        {Array.from({ length: columns }).map((_, columnIdx) => {
                          const globalIndex = startIndex + columnIdx
                          const product = mappedResults[globalIndex]
                          const shouldShowSkeleton =
                            !product && aggregatedHits.length < totalResults

                          if (product) {
                            return (
                              <ProductCard
                                key={`${product.id}-${product.handle ?? product.id}-${globalIndex}`}
                                product={product}
                              />
                            )
                          }

                          if (shouldShowSkeleton) {
                            return (
                              <ProductCardSkeleton
                                key={`skeleton-${globalIndex}`}
                              />
                            )
                          }

                          return <div key={`spacer-${globalIndex}`} />
                        })}
                      </div>
                    </div>
                  )
                })}
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
