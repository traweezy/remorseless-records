"use client"

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useWindowVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
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
import { motion } from "framer-motion"
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
import type { ProductSortOption } from "@/lib/search/search"
import { computeFacetCounts } from "@/lib/search/search"
import { useCatalogStore } from "@/lib/store/catalog"

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) {
    return false
  }

  const sortedA = [...a].sort()
  const sortedB = [...b].sort()

  return sortedA.every((value, index) => value === sortedB[index])
}

const COLLECTION_PRIORITY_LABELS = new Map<string, string>([
  ["featured", "Featured Picks"],
  ["featured-picks", "Featured Picks"],
  ["staff", "Staff Signals"],
  ["staff-picks", "Staff Signals"],
  ["staff-signals", "Staff Signals"],
  ["new-releases", "Newest Arrivals"],
  ["new arrivals", "Newest Arrivals"],
  ["newest arrivals", "Newest Arrivals"],
])

const deriveCollectionTitle = (hit: ProductSearchHit): string | null => {
  if (typeof hit.collectionTitle === "string" && hit.collectionTitle.trim().length) {
    return hit.collectionTitle.trim()
  }

  const handleCandidates = (hit.categoryHandles ?? [])
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length)

  for (const candidate of handleCandidates) {
    for (const [key, label] of COLLECTION_PRIORITY_LABELS) {
      if (candidate === key || candidate.includes(key)) {
        return label
      }
    }
  }

  const categoryCandidates = (hit.categories ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length)

  if (!categoryCandidates.length) {
    return null
  }

  for (const candidate of categoryCandidates) {
    const normalized = candidate.toLowerCase()
    for (const [key, label] of COLLECTION_PRIORITY_LABELS) {
      if (normalized === key || normalized.includes(key)) {
        return label
      }
    }
  }

  return categoryCandidates[0] ?? null
}

const deriveFormatLabels = (hit: ProductSearchHit): string[] => {
  const labels = new Set<string>()

  const sourceArrays = [
    hit.formats,
    hit.variantTitles,
    hit.format ? [hit.format] : [],
    hit.categories,
    hit.categoryHandles,
  ]

  sourceArrays.forEach((entries) => {
    if (!entries) {
      return
    }
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "string" || !entry.trim().length) {
        return
      }
      labels.add(entry.trim())
    })
  })

  return Array.from(labels)
}

export const mapHitToSummary = (hit: ProductSearchHit): RelatedProductSummary => {
  const fallbackCurrency = hit.defaultVariant?.currency ?? "usd"
  const fallbackVariant =
    hit.defaultVariant ??
    (typeof hit.priceAmount === "number"
      ? {
          id: `search-${hit.id}`,
          title: hit.format ?? "Variant",
          currency: fallbackCurrency,
          amount: hit.priceAmount,
          inStock: (hit.stockStatus ?? "").toLowerCase() !== "sold_out",
        }
      : null)

  return {
    id: hit.id,
    handle: hit.handle,
    title: hit.title,
    artist: hit.artist,
    album: hit.album,
    slug: hit.slug,
    subtitle: hit.subtitle ?? null,
    thumbnail: hit.thumbnail ?? null,
    collectionTitle: deriveCollectionTitle(hit),
    defaultVariant: fallbackVariant,
    formats: (() => {
      const labels = deriveFormatLabels(hit)
      if (labels.length) {
        return labels
      }
      if (fallbackVariant?.title) {
        return [fallbackVariant.title]
      }
      return []
    })(),
    genres: (hit.metalGenres?.length ? hit.metalGenres : hit.genres)?.filter(
      (entry): entry is string => Boolean(entry && entry.trim().length)
    ) ?? [],
  }
}

type GenreFilterSeed = {
  handle: string
  label: string
  rank?: number
}

type ProductSearchExperienceProps = {
  initialHits: ProductSearchHit[]
  pageSize?: number
  initialSort?: ProductSortOption
  genreFilters: GenreFilterSeed[]
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

type FilterOption = {
  value: string
  label: string
  count: number
}

const needsClientHydration = (hit: ProductSearchHit): boolean => {
  const handle = hit.handle?.trim()
  if (!handle) {
    return false
  }

  const missingGenres =
    !Array.isArray(hit.genres) || hit.genres.length === 0
  const missingMetalGenres =
    !Array.isArray(hit.metalGenres) || hit.metalGenres.length === 0
  const missingFormats =
    !Array.isArray(hit.formats) || hit.formats.length === 0
  const missingVariant = !hit.defaultVariant
  const missingCollection =
    !(hit.collectionTitle ?? "").toString().trim().length

  return (
    (missingGenres && missingMetalGenres) ||
    missingFormats ||
    missingVariant ||
    missingCollection
  )
}

const mergeHydratedHit = (
  original: ProductSearchHit,
  fallback: ProductSearchHit
): ProductSearchHit => {
  const mergedFormats = original.formats.length
    ? original.formats
    : fallback.formats
  const mergedVariant = original.defaultVariant ?? fallback.defaultVariant
  const mergedCollection =
    original.collectionTitle && original.collectionTitle.trim().length
      ? original.collectionTitle
      : fallback.collectionTitle

  return {
    ...fallback,
    ...original,
    defaultVariant: mergedVariant,
    collectionTitle: mergedCollection ?? null,
    formats: mergedFormats,
    genres: original.genres.length ? original.genres : fallback.genres,
    metalGenres: original.metalGenres.length
      ? original.metalGenres
      : fallback.metalGenres,
    categories: original.categories.length
      ? original.categories
      : fallback.categories,
    categoryHandles: original.categoryHandles.length
      ? original.categoryHandles
      : fallback.categoryHandles,
    variantTitles: original.variantTitles.length
      ? original.variantTitles
      : fallback.variantTitles,
    format: original.format ?? fallback.format ?? null,
    priceAmount: original.priceAmount ?? fallback.priceAmount ?? null,
    stockStatus: original.stockStatus ?? fallback.stockStatus ?? null,
  }
}

const hydrateHitsClient = async (
  hits: ProductSearchHit[]
): Promise<ProductSearchHit[]> => {
  const handlesToHydrate = Array.from(
    new Set(
      hits
        .filter(needsClientHydration)
        .map((hit) => hit.handle?.trim().toLowerCase())
        .filter((handle): handle is string => Boolean(handle))
    )
  )

  if (!handlesToHydrate.length) {
    return hits
  }

  try {
    const response = await fetch("/api/catalog/hydrate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ handles: handlesToHydrate }),
    })

    if (!response.ok) {
      return hits
    }

    const payload: { hits?: ProductSearchHit[] } = await response.json()
    const hydrationMap = new Map<string, ProductSearchHit>()

    payload.hits?.forEach((hit) => {
      const handleKey = hit.handle?.trim().toLowerCase()
      if (handleKey) {
        hydrationMap.set(handleKey, hit)
      }
    })

    if (!hydrationMap.size) {
      return hits
    }

    return hits.map((hit) => {
      const handleKey = hit.handle?.trim().toLowerCase()
      if (!handleKey) {
        return hit
      }
      const fallback = hydrationMap.get(handleKey)
      if (!fallback) {
        return hit
      }
      return mergeHydratedHit(hit, fallback)
    })
  } catch (error) {
    console.error("[catalog] Client hydration failed", error)
    return hits
  }
}

const FilterCheckboxList = ({
  title,
  options,
  selected,
  onToggle,
  variant = "chip",
  normalizeValue = (value: string) => value.trim(),
  defaultOpen = false,
}: {
  title: string
  options: FilterOption[]
  selected: string[]
  onToggle: (value: string) => void
  variant?: "chip" | "plain"
  normalizeValue?: (value: string) => string
  defaultOpen?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true)
    }
  }, [defaultOpen])

  if (!options.length) {
    return null
  }

  return (
    <details
      className="group space-y-3"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-[0.3rem] text-muted-foreground">
        <span>{title}</span>
        <ChevronDown className="h-3 w-3 transition duration-200 group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-1.5">
        {options.map(({ value, label, count }) => {
          const normalizedValue = normalizeValue(value)
          if (!normalizedValue.length) {
            return null
          }
          const checked = selected.includes(normalizedValue)
          const checkboxId = `${title.toLowerCase()}-${normalizedValue.replace(/\s+/g, "-")}`

          return (
            <label
              key={normalizedValue}
              htmlFor={checkboxId}
              className={cn(
                "flex items-center justify-between rounded-xl px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.22rem] leading-relaxed text-muted-foreground transition",
                variant === "chip"
                  ? cn(
                      "border border-border/60 bg-background/60 hover:border-destructive/70 hover:text-destructive",
                      checked && "border-destructive bg-destructive/20 text-destructive"
                    )
                  : cn("hover:text-destructive", checked && "text-destructive")
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(normalizedValue)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/60 bg-background/70 text-transparent transition peer-focus-visible:ring-2 peer-focus-visible:ring-destructive/60",
                    checked && "border-destructive bg-destructive text-background"
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="text-foreground">{label}</span>
              </span>
              <span className="text-[0.6rem] text-muted-foreground/80">{count}</span>
            </label>
          )
        })}
      </div>
    </details>
  )
}

const FilterSidebar = ({
  genres,
  artists,
  formats,
  productTypes,
  selectedGenres,
  selectedArtists,
  selectedFormats,
  selectedProductTypes,
  onToggleGenre,
  onToggleArtist,
  onToggleFormat,
  onToggleProductType,
  onClear,
  showInStockOnly,
  onToggleStock,
}: {
  genres: FilterOption[]
  artists: FilterOption[]
  formats: FilterOption[]
  productTypes: FilterOption[]
  selectedGenres: string[]
  selectedArtists: string[]
  selectedFormats: string[]
  selectedProductTypes: string[]
  onToggleGenre: (genre: string) => void
  onToggleArtist: (artist: string) => void
  onToggleFormat: (format: string) => void
  onToggleProductType: (type: string) => void
  onClear: () => void
  showInStockOnly: boolean
  onToggleStock: () => void
}) => (
  <div className="space-y-6">
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.35rem] text-muted-foreground">
          Filters
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-accent"
        >
          Reset
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleStock}
        className={cn(
          "flex w-full items-center justify-between rounded-full border px-4 py-2 text-[0.65rem] uppercase tracking-[0.3rem] transition",
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
      <FilterCheckboxList
        title="Genres"
        options={genres}
        selected={selectedGenres}
        onToggle={onToggleGenre}
        variant="plain"
        normalizeValue={(value) => value.trim().toLowerCase()}
        defaultOpen={selectedGenres.length > 0}
      />

      <Separator className="border-border/50" />

      <FilterCheckboxList
        title="Formats"
        options={formats}
        selected={selectedFormats}
        onToggle={onToggleFormat}
        defaultOpen={selectedFormats.length > 0}
      />

      <Separator className="border-border/50" />

      <FilterCheckboxList
        title="Product Type"
        options={productTypes}
        selected={selectedProductTypes}
        onToggle={onToggleProductType}
        defaultOpen={selectedProductTypes.length > 0}
      />

      <Separator className="border-border/50" />

      <FilterCheckboxList
        title="Artists"
        options={artists}
        selected={selectedArtists}
        onToggle={onToggleArtist}
        variant="plain"
        normalizeValue={(value) => value.trim().toLowerCase()}
        defaultOpen={selectedArtists.length > 0}
      />
    </div>
  </div>
)

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
  pageSize = 48,
  initialSort = "alphabetical",
  genreFilters,
}: ProductSearchExperienceProps) => {
  const normalizedGenreFilters = useMemo(
    () =>
      genreFilters
        .map((genre, index) => {
          const handle = genre.handle?.trim().toLowerCase() ?? ""
          const label = genre.label?.trim() ?? ""
          if (!handle.length || !label.length) {
            return null
          }
          const rank =
            typeof genre.rank === "number" ? genre.rank : index
          return { handle, label, rank }
        })
        .filter(
          (
            entry
          ): entry is { handle: string; label: string; rank: number } =>
            Boolean(entry)
        )
        .sort(
          (a, b) =>
            a.rank - b.rank || a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
        ),
    [genreFilters]
  )

  const genreLabelByHandle = useMemo(() => {
    const map = new Map<string, string>()
    normalizedGenreFilters.forEach((genre) => {
      map.set(genre.handle, genre.label)
    })
    return map
  }, [normalizedGenreFilters])

  const getGenreLabelForHandle = useCallback(
    (handle: string) =>
      genreLabelByHandle.get(handle) ?? humanizeCategoryHandle(handle),
    [genreLabelByHandle]
  )

  const resolveGenreHandle = useCallback(
    (rawValue: string | null | undefined): string | null => {
      if (typeof rawValue !== "string") {
        return null
      }
      const trimmed = rawValue.trim()
      if (!trimmed.length) {
        return null
      }
      const normalized = trimmed.toLowerCase()
      if (genreLabelByHandle.has(normalized)) {
        return normalized
      }
      for (const [handle, label] of genreLabelByHandle.entries()) {
        if (label.toLowerCase() === normalized) {
          return handle
        }
      }
      return normalized
    },
    [genreLabelByHandle]
  )

  const hasHydratedFromParams = useRef(false)
  const lastSerializedParamsRef = useRef<string>("")

  const query = useCatalogStore((state) => state.query)
  const selectedGenres = useCatalogStore((state) => state.genres)
  const selectedArtists = useCatalogStore((state) => state.artists)
  const selectedFormats = useCatalogStore((state) => state.formats)
  const selectedProductTypes = useCatalogStore((state) => state.productTypes)
  const showInStockOnly = useCatalogStore((state) => state.showInStockOnly)
  const sortOption = useCatalogStore((state) => state.sort)

  const setQuery = useCatalogStore((state) => state.setQuery)
  const toggleGenreFilter = useCatalogStore((state) => state.toggleGenre)
  const toggleArtistFilter = useCatalogStore((state) => state.toggleArtist)
  const toggleFormatFilter = useCatalogStore((state) => state.toggleFormat)
  const toggleProductTypeFilter = useCatalogStore((state) => state.toggleProductType)
  const toggleStockOnlyFilter = useCatalogStore((state) => state.toggleStockOnly)
  const setSortOption = useCatalogStore((state) => state.setSort)
  const clearFiltersStore = useCatalogStore((state) => state.clearFilters)
  const hydrateFromParams = useCatalogStore((state) => state.hydrateFromParams)

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const [catalogHits, setCatalogHits] = useState<ProductSearchHit[]>(initialHits)
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(pageSize, initialHits.length)
  )

  useEffect(() => {
    setCatalogHits(initialHits)
    setVisibleCount(Math.min(pageSize, initialHits.length))
  }, [initialHits, pageSize])

  useEffect(() => {
    if (!catalogHits.length) {
      return
    }
    if (!catalogHits.some(needsClientHydration)) {
      return
    }

    let cancelled = false
    const hydrate = async () => {
      const enriched = await hydrateHitsClient(catalogHits)
      if (!cancelled) {
        setCatalogHits(enriched)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [catalogHits])

  useEffect(() => {
    if (typeof window === "undefined" || hasHydratedFromParams.current) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const splitCsv = (values: string[]): string[] =>
      values
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry.length)

    const nextQuery = params.get("q") ?? ""
    const nextGenres = Array.from(
      new Set(
        splitCsv(params.getAll("genre"))
          .map((value) => resolveGenreHandle(value))
          .filter((value): value is string => Boolean(value))
      )
    )
    const normalizeArtistHandle = (value: string | null): string | null => {
      if (typeof value !== "string") {
        return null
      }
      const trimmed = value.trim().toLowerCase()
      return trimmed.length ? trimmed : null
    }
    const nextArtists = Array.from(
      new Set(
        splitCsv(params.getAll("artist"))
          .map((value) => normalizeArtistHandle(value))
          .filter((value): value is string => Boolean(value))
      )
    )
    const nextFormats = splitCsv(params.getAll("format"))
    const nextProductTypes = splitCsv(params.getAll("type"))
    const nextStock = params.get("stock") === "1"
    const nextSortParam = params.get("sort")
    const nextSort = SORT_OPTIONS.some(({ value }) => value === nextSortParam)
      ? (nextSortParam as ProductSortOption)
      : initialSort

    hydrateFromParams({
      query: nextQuery,
      genres: nextGenres,
      artists: nextArtists,
      formats: nextFormats,
      productTypes: nextProductTypes,
      showInStockOnly: nextStock,
      sort: nextSort,
    })

    hasHydratedFromParams.current = true
    lastSerializedParamsRef.current = params.toString()
  }, [hydrateFromParams, initialSort, resolveGenreHandle])

  const genresKey = useMemo(
    () => [...selectedGenres].sort().join("|"),
    [selectedGenres]
  )
  const artistsKey = useMemo(
    () => [...selectedArtists].sort().join("|"),
    [selectedArtists]
  )
  const formatsKey = useMemo(
    () => [...selectedFormats].sort().join("|"),
    [selectedFormats]
  )
  const productTypesKey = useMemo(
    () => [...selectedProductTypes].sort().join("|"),
    [selectedProductTypes]
  )

  const criteriaKey = useMemo(
    () =>
      [
        query.trim(),
        genresKey,
        artistsKey,
        formatsKey,
        productTypesKey,
        showInStockOnly ? "in-stock" : "all",
        sortOption,
      ].join("|"),
    [query, genresKey, artistsKey, formatsKey, productTypesKey, showInStockOnly, sortOption]
  )

  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedFromParams.current) {
      return
    }

    const params = new URLSearchParams()
    const trimmedQuery = query.trim()
    if (trimmedQuery.length) {
      params.set("q", trimmedQuery)
    }
    const setCsvParam = (key: string, values: string[]) => {
      if (values.length) {
        params.set(key, values.join(","))
      }
    }

    setCsvParam(
      "genre",
      selectedGenres.map((value) => value.trim()).filter((value) => value.length)
    )
    setCsvParam(
      "artist",
      selectedArtists.map((value) => value.trim()).filter((value) => value.length)
    )
    setCsvParam(
      "format",
      selectedFormats.map((value) => value.trim()).filter((value) => value.length)
    )
    setCsvParam(
      "type",
      selectedProductTypes.map((value) => value.trim()).filter((value) => value.length)
    )
    if (showInStockOnly) {
      params.set("stock", "1")
    }
    if (sortOption !== initialSort) {
      params.set("sort", sortOption)
    }

    const serialized = params.toString()
    if (serialized === lastSerializedParamsRef.current) {
      return
    }

    const nextUrl = serialized
      ? `${window.location.pathname}?${serialized}`
      : window.location.pathname
    window.history.replaceState(null, "", nextUrl)
    lastSerializedParamsRef.current = serialized
  }, [
    query,
    genresKey,
    artistsKey,
    formatsKey,
    productTypesKey,
    showInStockOnly,
    sortOption,
    initialSort,
  ])

  const aggregatedHits = useMemo(() => catalogHits, [catalogHits])

  const catalogFacets = useMemo(
    () => computeFacetCounts(aggregatedHits),
    [aggregatedHits]
  )

  const artistFacets = useMemo(() => {
    const counts: Record<string, number> = {}
    const labels = new Map<string, string>()

    aggregatedHits.forEach((hit) => {
      const handle =
        hit.slug?.artistSlug?.toLowerCase() ??
        hit.artist?.trim().toLowerCase() ??
        null
      if (!handle) {
        return
      }
      counts[handle] = (counts[handle] ?? 0) + 1
      if (!labels.has(handle)) {
        labels.set(handle, hit.artist ?? humanizeCategoryHandle(handle))
      }
    })

    return { counts, labels }
  }, [aggregatedHits])

  const filteredHits = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const requiredGenres = selectedGenres.map((value) => value.toLowerCase())
    const requiredArtists = selectedArtists.map((value) => value.toLowerCase())
    const requiredFormats = selectedFormats.map((value) => value.toLowerCase())
    const requiredProductTypes = selectedProductTypes.map((value) =>
      value.toLowerCase()
    )

    const matches = aggregatedHits.filter((hit) => {
      if (showInStockOnly) {
        const inStock =
          hit.defaultVariant?.inStock ??
          ((hit.stockStatus ?? "").toLowerCase() !== "sold_out")
        if (!inStock) {
          return false
        }
      }

      if (requiredGenres.length) {
        const handles = (hit.categoryHandles ?? []).map((value) => value.toLowerCase())
        const genreLabels = (hit.metalGenres ?? hit.genres ?? []).map((value) =>
          value.toLowerCase()
        )
        const combined = new Set([...handles, ...genreLabels])
        if (!requiredGenres.some((genre) => combined.has(genre))) {
          return false
        }
      }

      if (requiredArtists.length) {
        const artistHandle =
          hit.slug?.artistSlug?.toLowerCase() ??
          hit.artist?.trim().toLowerCase() ??
          ""
        if (!artistHandle.length || !requiredArtists.includes(artistHandle)) {
          return false
        }
      }

      if (requiredFormats.length) {
        const formats = (
          hit.formats?.length ? hit.formats : hit.variantTitles ?? []
        ).map((value) => value.toLowerCase())
        if (!requiredFormats.some((format) => formats.includes(format))) {
          return false
        }
      }

      if (requiredProductTypes.length) {
        const productType = hit.productType?.toLowerCase() ?? ""
        if (!requiredProductTypes.includes(productType)) {
          return false
        }
      }

      if (normalizedQuery.length) {
        const haystack = [
          hit.title,
          hit.artist,
          hit.album,
          hit.collectionTitle ?? "",
          ...(hit.genres ?? []),
          ...(hit.metalGenres ?? []),
        ]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(normalizedQuery)) {
          return false
        }
      }

      return true
    })

    const sorted = [...matches]
    if (sortOption === "alphabetical") {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortOption === "newest") {
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      )
    } else if (sortOption === "price-low") {
      sorted.sort((a, b) => (a.priceAmount ?? Infinity) - (b.priceAmount ?? Infinity))
    } else if (sortOption === "price-high") {
      sorted.sort((a, b) => (b.priceAmount ?? 0) - (a.priceAmount ?? 0))
    }

    return sorted
  }, [
    aggregatedHits,
    query,
    selectedGenres,
    selectedArtists,
    selectedFormats,
    selectedProductTypes,
    showInStockOnly,
    sortOption,
  ])

  const totalResults = filteredHits.length

  const mappedResults = useMemo(
    () => filteredHits.map(mapHitToSummary),
    [filteredHits]
  )

  const deferredResults = useDeferredValue(mappedResults)
  const columns = useResponsiveColumns()
  const rowEstimate = useMemo(() => {
    if (columns >= 4) return 420
    if (columns === 3) return 440
    if (columns === 2) return 460
    return 520
  }, [columns])

  const totalRowCount =
    columns > 0 ? Math.max(Math.ceil(deferredResults.length / columns), 1) : 1

  const virtualizer = useWindowVirtualizerCompat({
    count: totalRowCount,
    estimateSize: () => rowEstimate,
    overscan: 8,
    scrollMargin: 0,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    virtualizer.measure()
  }, [columns, rowEstimate, virtualizer])

  useEffect(() => {
    setVisibleCount((prev) => Math.min(prev, deferredResults.length))
  }, [deferredResults.length])

  useEffect(() => {
    const baseVisible =
      filteredHits.length > 0 ? Math.min(pageSize, filteredHits.length) : 0
    setVisibleCount(baseVisible)
  }, [criteriaKey, filteredHits.length, pageSize])

  useEffect(() => {
    if (!virtualItems.length) {
      return
    }

    const lastVirtualRow = virtualItems[virtualItems.length - 1]
    if (!lastVirtualRow) {
      return
    }

    const approxRendered = Math.min(
      (lastVirtualRow.index + 1) * columns,
      deferredResults.length
    )
    const remainingBeforeVisibleEnd = Math.max(visibleCount - approxRendered, 0)
    const threshold = Math.max(columns * 2, pageSize)

    if (
      remainingBeforeVisibleEnd <= threshold &&
      visibleCount < deferredResults.length
    ) {
      setVisibleCount((prev) =>
        Math.min(deferredResults.length, prev + Math.max(pageSize, columns * 2))
      )
    }
  }, [virtualItems, columns, deferredResults.length, pageSize, visibleCount])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.scrollTo({ top: 0 })
    virtualizer.scrollToIndex(0, { align: "start" })
  }, [criteriaKey, virtualizer])

  const activeFiltersCount =
    selectedGenres.length +
    selectedArtists.length +
    selectedFormats.length +
    selectedProductTypes.length +
    (showInStockOnly ? 1 : 0)

  const filterChipClass =
    "inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.25rem] text-foreground shadow-[0_0_15px_rgba(255,0,0,0.18)] transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"

  const categoryFacetCounts = useMemo(
    () =>
      Object.entries(catalogFacets.categories ?? {}).reduce<Record<string, number>>(
        (acc, [rawKey, rawCount]) => {
          const key = rawKey.trim().toLowerCase()
          if (!key.length) {
            return acc
          }
          acc[key] = rawCount
          return acc
        },
        {}
      ),
    [catalogFacets.categories]
  )

  const genreOptions = useMemo(() => {
    type RankedOption = FilterOption & { rank: number }

    const baseOptions: RankedOption[] = normalizedGenreFilters.map((genre) => ({
      value: genre.handle,
      label: genre.label,
      count: categoryFacetCounts[genre.handle] ?? 0,
      rank: genre.rank,
    }))

    return baseOptions
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          b.count - a.count ||
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      )
      .map(({ rank: _rank, ...option }) => option)
  }, [categoryFacetCounts, normalizedGenreFilters, genreLabelByHandle])

  const artistOptions = useMemo(
    () =>
      Object.entries(artistFacets.counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({
          value,
          label: artistFacets.labels.get(value) ?? humanizeCategoryHandle(value),
          count,
        })),
    [artistFacets]
  )

  const formatOptions = useMemo(
    () =>
      (Object.entries(catalogFacets.variants ?? {}) as Array<[string, number]>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([value, count]) => ({
          value,
          label: value,
          count,
        })),
    [catalogFacets.variants]
  )

  const formatProductTypeLabel = useCallback(
    (value: string) =>
      value
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    []
  )

  const productTypeOptions = useMemo(
    () =>
      (Object.entries(catalogFacets.productTypes ?? {}) as Array<[string, number]>)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: formatProductTypeLabel(value),
          count,
        })),
    [catalogFacets.productTypes]
  )

  const handleToggleGenre = (genre: string) => {
    const normalizedGenre = genre.trim().toLowerCase()
    if (!normalizedGenre.length) {
      return
    }
    toggleGenreFilter(normalizedGenre)
  }

  const handleToggleArtist = (artist: string) => {
    const normalized = artist.trim().toLowerCase()
    if (!normalized.length) {
      return
    }
    toggleArtistFilter(normalized)
  }

  const handleToggleFormat = (formatValue: string) => {
    if (!formatValue.trim().length) {
      return
    }
    toggleFormatFilter(formatValue)
  }

  const handleToggleProductType = (type: string) => {
    if (!type.trim().length) {
      return
    }
    toggleProductTypeFilter(type)
  }

  const clearFilters = () => {
    clearFiltersStore()
  }

  const toggleStockOnly = () => {
    toggleStockOnlyFilter()
  }

  const gridTemplateStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    }),
    [columns]
  )

  const isFetching = false

  return (
    <div className="bg-background pb-8">
      <div className="container flex flex-col gap-4 px-2 pt-4 sm:px-4 lg:flex-row lg:gap-8">
        <aside className="hidden lg:block lg:w-60 lg:flex-shrink-0">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto bg-background/90 px-4 py-5 scrollbar-metal supports-[backdrop-filter]:backdrop-blur-xl">
            <FilterSidebar
              genres={genreOptions}
              artists={artistOptions}
              formats={formatOptions}
              productTypes={productTypeOptions}
              selectedGenres={selectedGenres}
              selectedArtists={selectedArtists}
              selectedFormats={selectedFormats}
              selectedProductTypes={selectedProductTypes}
              onToggleGenre={handleToggleGenre}
              onToggleArtist={handleToggleArtist}
              onToggleFormat={handleToggleFormat}
              onToggleProductType={handleToggleProductType}
              onClear={clearFilters}
              showInStockOnly={showInStockOnly}
              onToggleStock={toggleStockOnly}
            />
          </div>
        </aside>

        <div className="flex-1 space-y-6">
          <header className="relative sticky top-14 z-20 space-y-2 border-b border-border/40 bg-background/85 px-2 py-2 supports-[backdrop-filter]:backdrop-blur-lg sm:px-4 lg:px-6">
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
                        genres={genreOptions}
                        artists={artistOptions}
                        formats={formatOptions}
                        productTypes={productTypeOptions}
                        selectedGenres={selectedGenres}
                        selectedArtists={selectedArtists}
                        selectedFormats={selectedFormats}
                        selectedProductTypes={selectedProductTypes}
                        onToggleGenre={handleToggleGenre}
                        onToggleArtist={handleToggleArtist}
                        onToggleFormat={handleToggleFormat}
                        onToggleProductType={handleToggleProductType}
                        onClear={() => {
                          clearFilters()
                          setMobileFiltersOpen(false)
                        }}
                        showInStockOnly={showInStockOnly}
                        onToggleStock={toggleStockOnly}
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
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  placeholder="Seek brutality…"
                  className="h-9 flex-1 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:border-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  type="search"
                  autoComplete="off"
                />
              </div>
              <SortDropdown value={sortOption} onChange={setSortOption} />
            </div>

            {(selectedGenres.length ||
              selectedArtists.length ||
              selectedFormats.length ||
              selectedProductTypes.length ||
              showInStockOnly) && (
              <div className="flex flex-wrap items-center gap-2">
                {selectedFormats.map((formatValue) => (
                  <button
                    key={`active-format-${formatValue}`}
                    type="button"
                    onClick={() => handleToggleFormat(formatValue)}
                    className={filterChipClass}
                  >
                    {formatValue} ✕
                  </button>
                ))}
                {selectedProductTypes.map((type) => (
                  <button
                    key={`active-product-type-${type}`}
                    type="button"
                    onClick={() => handleToggleProductType(type)}
                    className={filterChipClass}
                  >
                    {formatProductTypeLabel(type)} ✕
                  </button>
                ))}
                {selectedArtists.map((artist) => (
                  <button
                    key={`active-artist-${artist}`}
                    type="button"
                    onClick={() => handleToggleArtist(artist)}
                    className={filterChipClass}
                  >
                    {artistFacets.labels.get(artist) ?? humanizeCategoryHandle(artist)} ✕
                  </button>
                ))}
                {selectedGenres.map((genre) => (
                  <button
                    key={`active-genre-${genre}`}
                    type="button"
                    onClick={() => handleToggleGenre(genre)}
                    className={filterChipClass}
                  >
                    {getGenreLabelForHandle(genre)} ✕
                  </button>
                ))}
                {showInStockOnly ? (
                  <button
                    type="button"
                    onClick={toggleStockOnly}
                    className={filterChipClass}
                  >
                    In stock ✕
                  </button>
                ) : null}
              </div>
            )}
          </header>

          <section className="space-y-4 px-2 sm:px-4 lg:px-6">
            {isFetching ? (
              <div className="text-sm uppercase tracking-[0.3rem] text-muted-foreground">
                Refreshing results…
              </div>
            ) : null}

            {deferredResults.length ? (
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualItems.map((virtualRow: VirtualItem) => {
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
                          const isLoaded = globalIndex < visibleCount
                          const product = isLoaded ? deferredResults[globalIndex] : undefined
                          const shouldShowSkeleton =
                            !product && globalIndex < deferredResults.length

                          if (product) {
                            return (
                              <motion.div
                                key={`${product.id}-${product.handle ?? product.id}-${globalIndex}`}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                <ProductCard
                                  product={product}
                                />
                              </motion.div>
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
