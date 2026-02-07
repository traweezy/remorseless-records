"use client"

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Virtualizer,
  observeWindowOffset,
  observeWindowRect,
  type PartialKeys,
  type VirtualItem,
  type VirtualizerOptions,
  windowScroll,
} from "@tanstack/virtual-core"
import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowUp10,
  Check,
  ChevronDown,
  Clock,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import fuzzysort from "fuzzysort"
import { Button } from "@/components/ui/button"
import Drawer from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import ProductCard from "@/components/product-card"
import type { ProductSearchHit, RelatedProductSummary } from "@/types/product"
import { humanizeCategoryHandle } from "@/lib/products/categories"
import { cn } from "@/lib/ui/cn"
import { PillDropdown, type PillDropdownOption } from "@/components/ui/pill-dropdown"
import type { ProductSortOption } from "@/lib/search/search"
import { computeFacetCounts } from "@/lib/search/search"
import { useCatalogStore } from "@/lib/store/catalog"
import { normalizeFormatValue as baseNormalizeFormat } from "@/lib/search/normalize"

const normalizeFormatSafe = baseNormalizeFormat as (
  value: string | null | undefined
) => string | null

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
  const canonical = new Set<string>()
  const raw = new Set<string>()

  const add = (value: string | null | undefined) => {
    if (!value || typeof value !== "string") {
      return
    }
    const trimmed = value.trim()
    if (!trimmed.length) {
      return
    }
    const normalized = normalizeFormatSafe(trimmed)
    if (normalized) {
      canonical.add(normalized)
      return
    }
    raw.add(trimmed)
  }

  const sourceArrays = [hit.formats, hit.variantTitles, hit.format ? [hit.format] : []]

  sourceArrays.forEach((entries) => {
    if (!entries) {
      return
    }
    entries.forEach(add)
  })

  const preferred = canonical.size ? canonical : raw
  return Array.from(preferred)
}

export const mapHitToSummary = (hit: ProductSearchHit): RelatedProductSummary => {
  const fallbackCurrency = hit.defaultVariant?.currency ?? "usd"
  const fallbackStockStatus = hit.stockStatus ?? "unknown"
  const fallbackInStock = fallbackStockStatus !== "sold_out"
  const fallbackVariant =
    hit.defaultVariant ??
    (typeof hit.priceAmount === "number"
      ? {
          id: `search-${hit.id}`,
          title: hit.format ?? "Variant",
          currency: fallbackCurrency,
          amount: hit.priceAmount,
          hasPrice: true,
          inStock: fallbackInStock,
          stockStatus: fallbackStockStatus,
          inventoryQuantity: null,
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
  initialSort?: ProductSortOption
  genreFilters: GenreFilterSeed[]
}

const CARD_MOTION_PROPS = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: "easeOut" },
} as const

const SORT_OPTIONS: [
  PillDropdownOption<ProductSortOption>,
  ...Array<PillDropdownOption<ProductSortOption>>
] = [
  {
    value: "title-asc",
    label: "Title · A → Z",
    helper: "Alphabetical ascending",
    Icon: ArrowDownAZ,
  },
  {
    value: "title-desc",
    label: "Title · Z → A",
    helper: "Alphabetical descending",
    Icon: ArrowUp10,
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

  const missingStockStatus =
    !hit.stockStatus || hit.stockStatus === "unknown"
  const missingInventoryQuantity =
    hit.defaultVariant?.inventoryQuantity == null ||
    hit.defaultVariant?.stockStatus === "unknown"

  return (
    (missingGenres && missingMetalGenres) ||
    missingFormats ||
    missingVariant ||
    missingCollection ||
    missingStockStatus ||
    missingInventoryQuantity
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
  const mergedStockStatus =
    original.stockStatus && original.stockStatus !== "unknown"
      ? original.stockStatus
      : fallback.stockStatus ?? original.stockStatus ?? null

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
    stockStatus: mergedStockStatus,
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

  const hydrationMap = new Map<string, ProductSearchHit>()
  const batchSize = 40
  const batches: string[][] = []
  for (let i = 0; i < handlesToHydrate.length; i += batchSize) {
    batches.push(handlesToHydrate.slice(i, i + batchSize))
  }

  try {
    const results = await Promise.all(
      batches.map(async (batch) => {
        const response = await fetch("/api/catalog/hydrate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ handles: batch }),
        })

        if (!response.ok) {
          return []
        }

        const payloadRaw: unknown = await response.json()
        const hitsFromPayload = Array.isArray(
          (payloadRaw as { hits?: unknown[] } | null)?.hits
        )
          ? ((payloadRaw as { hits?: ProductSearchHit[] }).hits ?? [])
          : []
        return hitsFromPayload
      })
    )

    results.flat().forEach((hit) => {
      const handleKey = hit.handle?.trim().toLowerCase()
      if (handleKey) {
        hydrationMap.set(handleKey, hit)
      }
    })
  } catch (error) {
    console.error("[catalog] Client hydration failed", error)
    return hits
  }

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
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-foreground"
        aria-expanded={isOpen}
        aria-controls={`${title}-filters`}
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="content"
            id={`${title}-filters`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-1 flex flex-col gap-1.5">
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
                      "flex cursor-pointer items-center justify-between rounded-xl px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.22rem] leading-relaxed text-muted-foreground transition hover:text-foreground",
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

const FilterSidebar = ({
  genres,
  formats,
  productTypes,
  selectedGenres,
  selectedFormats,
  selectedProductTypes,
  onToggleGenre,
  onToggleFormat,
  onToggleProductType,
  onClear,
  showInStockOnly,
  onToggleStock,
}: {
  genres: FilterOption[]
  formats: FilterOption[]
  productTypes: FilterOption[]
  selectedGenres: string[]
  selectedFormats: string[]
  selectedProductTypes: string[]
  onToggleGenre: (genre: string) => void
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
        className="cursor-pointer text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-foreground"
      >
        Reset
      </button>
      </div>
      <button
        type="button"
        onClick={onToggleStock}
        className="flex w-full items-center justify-between rounded-full border border-border/40 bg-background/70 px-4 py-2 text-[0.65rem] uppercase tracking-[0.3rem] text-foreground transition hover:border-border/60 focus-visible:outline-none focus-visible:ring-0"
      >
        <span className="select-none">In stock</span>
        <span
          className={cn(
            "inline-flex h-5 w-10 items-center rounded-full border border-border/60 bg-background px-1 transition",
            showInStockOnly && "justify-end border-destructive"
          )}
          aria-hidden
        >
          <span
            className={cn(
              "h-3.5 w-3.5 rounded-full bg-border transition",
              showInStockOnly && "bg-destructive"
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
        variant="plain"
        normalizeValue={(value) => value.trim().toLowerCase()}
        defaultOpen={selectedFormats.length > 0}
      />

      <Separator className="border-border/50" />

      <FilterCheckboxList
        title="Product Type"
        options={productTypes}
        selected={selectedProductTypes}
        onToggle={onToggleProductType}
        variant="plain"
        normalizeValue={(value) => value.trim().toLowerCase()}
        defaultOpen={selectedProductTypes.length > 0}
      />
    </div>
  </div>
)

const SortDropdown = ({
  value,
  onChange,
  focusSearch,
}: {
  value: ProductSortOption
  onChange: (value: ProductSortOption) => void
  focusSearch: () => void
}) => {
  return (
    <PillDropdown
      value={value}
      options={SORT_OPTIONS}
      onChange={(next) => {
        onChange(next)
        focusSearch()
      }}
    />
  )
}

const useWindowVirtualizerCompat = (
  options: PartialKeys<
    VirtualizerOptions<Window, Element>,
    | "getScrollElement"
    | "observeElementRect"
    | "observeElementOffset"
    | "scrollToFn"
    | "initialOffset"
  >
) => {
  "use no memo"
  const rerender = useState({})[1]
  const scheduleRef = useRef(false)
  const mountedRef = useRef(true)

  const scheduleRerender = useCallback(() => {
    if (!mountedRef.current) {
      return
    }
    if (scheduleRef.current) {
      return
    }
    scheduleRef.current = true

    const run = () => {
      if (!mountedRef.current) {
        return
      }
      scheduleRef.current = false
      rerender({})
    }

    if (typeof queueMicrotask === "function") {
      queueMicrotask(run)
      return
    }

    void Promise.resolve().then(run)
  }, [rerender])

  const resolvedOptions: VirtualizerOptions<Window, Element> = {
    getScrollElement: () => (typeof document !== "undefined" ? window : null),
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    initialOffset: () => (typeof document !== "undefined" ? window.scrollY : 0),
    ...options,
    onChange: (instance, isScrolling) => {
      scheduleRerender()
      options.onChange?.(instance, isScrolling)
    },
  }

  const [instance] = useState(
    () => new Virtualizer<Window, Element>(resolvedOptions)
  )

  instance.setOptions(resolvedOptions)

  const useIsomorphicLayoutEffect =
    typeof window !== "undefined" ? useLayoutEffect : useEffect

  useIsomorphicLayoutEffect(() => instance._didMount(), [instance])
  useIsomorphicLayoutEffect(() => instance._willUpdate())
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return instance
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
  initialSort = "title-asc",
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
  const selectedFormats = useCatalogStore((state) => state.formats)
  const selectedProductTypes = useCatalogStore((state) => state.productTypes)
  const showInStockOnly = useCatalogStore((state) => state.showInStockOnly)
  const sortOption = useCatalogStore((state) => state.sort)

  const setQuery = useCatalogStore((state) => state.setQuery)
  const toggleGenreFilter = useCatalogStore((state) => state.toggleGenre)
  const toggleFormatFilter = useCatalogStore((state) => state.toggleFormat)
  const toggleProductTypeFilter = useCatalogStore((state) => state.toggleProductType)
  const toggleStockOnlyFilter = useCatalogStore((state) => state.toggleStockOnly)
  const setSortOption = useCatalogStore((state) => state.setSort)
  const clearFiltersStore = useCatalogStore((state) => state.clearFilters)
  const hydrateFromParams = useCatalogStore((state) => state.hydrateFromParams)

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const measureScheduledRef = useRef(false)

  const normalizeHits = useCallback(
    (hits: ProductSearchHit[]) =>
      hits.filter((hit) => Boolean(hit.handle?.trim().length)),
    []
  )

  const [catalogHits, setCatalogHits] = useState<ProductSearchHit[]>(
    normalizeHits(initialHits)
  )

  useEffect(() => {
    setCatalogHits(normalizeHits(initialHits))
  }, [initialHits, normalizeHits])

  useEffect(() => {
    if (!initialHits.length) {
      return
    }
    if (!initialHits.some(needsClientHydration)) {
      return
    }

    let cancelled = false
    const hydrate = async () => {
      const enriched = await hydrateHitsClient(initialHits)
      if (!cancelled) {
        setCatalogHits(normalizeHits(enriched))
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [initialHits, normalizeHits])

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
  const formatsKey = useMemo(
    () => [...selectedFormats].sort().join("|"),
    [selectedFormats]
  )
  const productTypesKey = useMemo(
    () => [...selectedProductTypes].sort().join("|"),
    [selectedProductTypes]
  )
  const genreCsvValues = useMemo(
    () => selectedGenres.map((value) => value.trim()).filter((value) => value.length),
    [selectedGenres]
  )
  const formatCsvValues = useMemo(
    () => selectedFormats.map((value) => value.trim()).filter((value) => value.length),
    [selectedFormats]
  )
  const productTypeCsvValues = useMemo(
    () => selectedProductTypes.map((value) => value.trim()).filter((value) => value.length),
    [selectedProductTypes]
  )

  const criteriaKey = useMemo(
    () =>
      [
        query.trim(),
        genresKey,
        formatsKey,
        productTypesKey,
        showInStockOnly ? "in-stock" : "all",
        sortOption,
      ].join("|"),
    [query, genresKey, formatsKey, productTypesKey, showInStockOnly, sortOption]
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

    setCsvParam("genre", genreCsvValues)
    setCsvParam("format", formatCsvValues)
    setCsvParam("type", productTypeCsvValues)
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
    formatsKey,
    productTypesKey,
    showInStockOnly,
    sortOption,
    initialSort,
    genreCsvValues,
    formatCsvValues,
    productTypeCsvValues,
  ])

  const aggregatedHits = useMemo(() => catalogHits, [catalogHits])

  const catalogFacets = useMemo(
    () => computeFacetCounts(aggregatedHits),
    [aggregatedHits]
  )

  const filteredHits = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const requiredGenres = selectedGenres.map((value) => value.toLowerCase())
    const requiredFormats = selectedFormats.map((value) => value.toLowerCase())
    const requiredProductTypes = selectedProductTypes.map((value) =>
      value.toLowerCase()
    )

    const baseMatches = aggregatedHits.filter((hit) => {
      if (showInStockOnly) {
        const isPriced = hit.defaultVariant?.hasPrice ?? false
        const inStock =
          isPriced &&
          (hit.defaultVariant?.inStock ??
            ((hit.stockStatus ?? "").toLowerCase() !== "sold_out"))
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

      return true
    })

    const matches = (() => {
      if (!normalizedQuery.length) {
        return baseMatches
      }

      const normalizeValue = (value: string | null | undefined) =>
        value
          ? value
              .normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .trim()
          : ""

      const tokens = normalizedQuery
        .split(/\s+/)
        .map((token) => normalizeValue(token))
        .filter(Boolean)

      const buildHaystacks = (hit: ProductSearchHit) => {
        const fields = [
          hit.artist,
          hit.title,
          hit.album,
          hit.slug?.artist,
          hit.slug?.album,
          hit.handle,
        ]
        return fields
          .map((value) => normalizeValue(value))
          .filter(Boolean)
      }

      const filtered = baseMatches.filter((hit) => {
        const haystacks = buildHaystacks(hit)
        if (!haystacks.length) {
          return false
        }

        return tokens.every((token) =>
          haystacks.some((haystack) => {
            if (haystack.includes(token)) {
              return true
            }
            const fuzzy = fuzzysort.single(token, haystack)
            return Boolean(fuzzy && fuzzy.score >= -120)
          })
        )
      })

      return filtered
    })()

    const sorted = [...matches]
    if (sortOption === "title-asc") {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortOption === "title-desc") {
      sorted.sort((a, b) => b.title.localeCompare(a.title))
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
  const gridMeasureRef = useRef<HTMLDivElement | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  useLayoutEffect(() => {
    const node = gridMeasureRef.current
    if (!node) {
      return
    }

    const update = () => {
      setGridWidth(node.clientWidth)
    }

    update()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update)
      return () => {
        window.removeEventListener("resize", update)
      }
    }

    const observer = new ResizeObserver(() => {
      update()
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  const rowEstimate = useMemo(() => {
    if (gridWidth > 0 && columns > 0) {
      const gap = columns > 1 ? 24 : 0
      const columnWidth = (gridWidth - gap * (columns - 1)) / columns
      const estimated = columnWidth + 240
      return Math.max(Math.round(estimated), 360)
    }

    if (columns >= 4) return 520
    if (columns === 3) return 580
    if (columns === 2) return 720
    return 820
  }, [columns, gridWidth])

  const totalRowCount =
    columns > 0 ? Math.max(Math.ceil(deferredResults.length / columns), 1) : 1

  const [, forceVirtualizerRerender] = useState(0)
  const rowGap = columns > 2 ? 16 : 12
  const rowHeight = rowEstimate + rowGap

  const virtualizer = useWindowVirtualizerCompat({
    count: totalRowCount,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: 0,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useLayoutEffect(() => {
    virtualizer.measure()
    forceVirtualizerRerender((tick) => tick + 1)
  }, [columns, rowHeight, virtualizer, forceVirtualizerRerender])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    window.scrollTo({ top: 0 })
    virtualizer.scrollToIndex(0, { align: "start" })
  }, [criteriaKey, virtualizer])

  const scheduleVirtualizerMeasure = useCallback(() => {
    if (measureScheduledRef.current) {
      return
    }
    measureScheduledRef.current = true

    const run = () => {
      measureScheduledRef.current = false
      virtualizer.measure()
      forceVirtualizerRerender((tick) => tick + 1)
    }

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run)
      return
    }

    setTimeout(run, 0)
  }, [virtualizer, forceVirtualizerRerender])

  const activeFiltersCount =
    selectedGenres.length +
    selectedFormats.length +
    selectedProductTypes.length +
    (showInStockOnly ? 1 : 0)
  const hasSearch = query.trim().length > 0
  const hasActiveFilters = activeFiltersCount > 0

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
  }, [categoryFacetCounts, normalizedGenreFilters])

  const formatOptions = useMemo(() => {
    const ALLOWED = new Set(["Cassette", "Vinyl", "CD"])
    const counts = new Map<string, Set<string>>()

    const add = (handle: string | null | undefined, value: string | null | undefined) => {
      if (!handle) {
        return
      }
      const normalized = normalizeFormatSafe(value)
      if (typeof normalized !== "string" || !ALLOWED.has(normalized)) {
        return
      }
      const bucket = counts.get(normalized) ?? new Set<string>()
      bucket.add(handle)
      counts.set(normalized, bucket)
    }

    aggregatedHits.forEach((hit) => {
      const handle = hit.handle?.trim().toLowerCase()
      if (!handle) {
        return
      }
      add(handle, hit.format)
      hit.variantTitles?.forEach((variant) => add(handle, variant))
      hit.formats?.forEach((fmt) => add(handle, fmt))
    })

    // Fallback to facet counts if aggregated hits are empty
    if (!counts.size && catalogFacets.format) {
      Object.entries(catalogFacets.format).forEach(([key, count]) => {
        const normalized = normalizeFormatSafe(key)
        if (!normalized || !ALLOWED.has(normalized)) {
          return
        }
        const bucket = counts.get(normalized) ?? new Set<string>()
        if (typeof count === "number" && Number.isFinite(count)) {
          const syntheticHandles = Array.from({ length: Math.max(1, Math.trunc(count)) }).map(
            (_, idx) => `${normalized}-${idx}`
          )
          syntheticHandles.forEach((handle) => bucket.add(handle))
        }
        counts.set(normalized, bucket)
      })
    }

    return Array.from(counts.entries())
      .map(([value, handles]) => ({ value, label: value, count: handles.size }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }, [aggregatedHits, catalogFacets.format])

  const formatProductTypeLabel = useCallback(
    (value: string) =>
      value
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    []
  )

  const productTypeOptions = useMemo(
    () =>
      Object.entries(catalogFacets.productTypes ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: formatProductTypeLabel(value),
          count,
        })),
    [catalogFacets.productTypes, formatProductTypeLabel]
  )

  useEffect(() => {
    if (!hasHydratedFromParams.current) {
      return
    }

    const validGenres = new Set(genreOptions.map((option) => option.value))
    const validFormats = new Set(formatOptions.map((option) => option.value))
    const validTypes = new Set(productTypeOptions.map((option) => option.value))

    const sanitizedGenres = selectedGenres.filter((value) => validGenres.has(value))
    const sanitizedFormats = selectedFormats.filter((value) => validFormats.has(value))
    const sanitizedTypes = selectedProductTypes.filter((value) => validTypes.has(value))

    const needsUpdate =
      sanitizedGenres.length !== selectedGenres.length ||
      sanitizedFormats.length !== selectedFormats.length ||
      sanitizedTypes.length !== selectedProductTypes.length

    if (needsUpdate) {
      hydrateFromParams({
        genres: sanitizedGenres,
        formats: sanitizedFormats,
        productTypes: sanitizedTypes,
      })
    }
  }, [
    formatOptions,
    genreOptions,
    hydrateFromParams,
    productTypeOptions,
    selectedFormats,
    selectedGenres,
    selectedProductTypes,
  ])

  const focusSearchInput = () => {
    const input = searchInputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }

  const handleToggleGenre = (genre: string) => {
    const normalizedGenre = genre.trim().toLowerCase()
    if (!normalizedGenre.length) {
      return
    }
    toggleGenreFilter(normalizedGenre)
    focusSearchInput()
  }

  const handleToggleFormat = (formatValue: string) => {
    if (!formatValue.trim().length) {
      return
    }
    toggleFormatFilter(formatValue)
    focusSearchInput()
  }

  const handleToggleProductType = (type: string) => {
    if (!type.trim().length) {
      return
    }
    toggleProductTypeFilter(type)
    focusSearchInput()
  }

  const clearFilters = () => {
    clearFiltersStore()
    focusSearchInput()
  }

  const toggleStockOnly = () => {
    toggleStockOnlyFilter()
    focusSearchInput()
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
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pt-4 sm:px-6 lg:flex-row lg:gap-8 lg:px-8">
        <aside className="hidden lg:block lg:w-60 lg:flex-shrink-0">
          <div className="sticky top-24 h-[calc(100vh-7rem)] overflow-y-auto bg-background/90 px-4 py-5 scrollbar-metal supports-[backdrop-filter]:backdrop-blur-xl">
            <FilterSidebar
              genres={genreOptions}
              formats={formatOptions}
              productTypes={productTypeOptions}
              selectedGenres={selectedGenres}
              selectedFormats={selectedFormats}
              selectedProductTypes={selectedProductTypes}
              onToggleGenre={handleToggleGenre}
              onToggleFormat={handleToggleFormat}
              onToggleProductType={handleToggleProductType}
              onClear={clearFilters}
              showInStockOnly={showInStockOnly}
              onToggleStock={toggleStockOnly}
            />
          </div>
        </aside>

        <div className="flex-1 space-y-6">
          <header className="relative sticky top-16 z-20 space-y-2 border-b border-border/40 bg-background/85 px-2 py-2 supports-[backdrop-filter]:backdrop-blur-lg sm:px-4 lg:px-6">
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
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex h-11 items-center gap-2 rounded-full border-border/50 px-4 text-xs uppercase tracking-[0.3rem]"
                  onClick={() => setMobileFiltersOpen(true)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters{activeFiltersCount ? ` (${activeFiltersCount})` : ""}
                </Button>

                <Drawer
                  open={mobileFiltersOpen}
                  onOpenChange={setMobileFiltersOpen}
                  side="left"
                  ariaLabel="Filters"
                  maxWidthClassName="max-w-[360px]"
                >
                  <div className="flex h-full flex-col overflow-hidden">
                    <header className="flex items-start justify-between border-b border-border/60 px-6 py-4">
                      <div className="space-y-1 text-left">
                        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                          Filters
                        </p>
                        <p className="text-lg font-semibold uppercase tracking-[0.3rem] text-foreground">
                          Tune your search
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        aria-label="Close filters"
                        onClick={() => setMobileFiltersOpen(false)}
                      >
                        <span className="sr-only">Close filters</span>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </header>

                    <div className="flex-1 overflow-y-auto px-6 pb-10 pt-2">
                      <FilterSidebar
                        genres={genreOptions}
                        formats={formatOptions}
                        productTypes={productTypeOptions}
                        selectedGenres={selectedGenres}
                        selectedFormats={selectedFormats}
                        selectedProductTypes={selectedProductTypes}
                        onToggleGenre={handleToggleGenre}
                        onToggleFormat={handleToggleFormat}
                        onToggleProductType={handleToggleProductType}
                        onClear={() => {
                          clearFilters()
                          setMobileFiltersOpen(false)
                        }}
                        showInStockOnly={showInStockOnly}
                        onToggleStock={toggleStockOnly}
                      />
                    </div>
                    <div className="border-t border-border/60 px-6 py-4">
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setMobileFiltersOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                </Drawer>
              </div>
              <div className="group flex h-11 min-w-[240px] flex-1 items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-2 transition-[border-color,box-shadow] supports-[backdrop-filter]:backdrop-blur-lg hover:border-border focus-within:border-destructive focus-within:shadow-[0_0_0_2px_hsl(var(--destructive)/0.45)]">
                <Search
                  className="h-4 w-4 text-muted-foreground transition group-focus-within:text-destructive"
                  aria-hidden
                />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  placeholder="Seek brutality…"
                  className="h-9 flex-1 appearance-none border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80 transition-[color] focus:border-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  type="search"
                  autoComplete="off"
                />
              </div>
              <SortDropdown
                value={sortOption}
                onChange={(next) => {
                  setSortOption(next)
                  focusSearchInput()
                }}
                focusSearch={focusSearchInput}
              />
            </div>

            {(selectedGenres.length ||
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
                ref={gridMeasureRef}
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                <AnimatePresence initial={false}>
                  {virtualItems.map((virtualRow: VirtualItem) => {
                    const rowIndex = virtualRow.index
                    const startIndex = rowIndex * columns
                    const rowReactKey =
                      deferredResults[startIndex]?.id ??
                      (virtualRow as { key?: number }).key ??
                      virtualRow.index

                    return (
                      <div
                        key={rowReactKey}
                        data-index={virtualRow.index}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: rowHeight,
                          transform: `translateY(${virtualRow.start}px)`,
                          paddingBottom: rowGap,
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          className="grid h-full gap-6"
                          style={gridTemplateStyle}
                        >
                          {Array.from({ length: columns }).map((_, columnIdx) => {
                            const globalIndex = startIndex + columnIdx
                            const product = deferredResults[globalIndex]

                            if (product) {
                              return (
                                  <motion.div
                                    key={`${product.id}-${product.handle ?? product.id}-${globalIndex}`}
                                    {...CARD_MOTION_PROPS}
                                  >
                                  <ProductCard
                                    product={product}
                                    onMediaLoad={scheduleVirtualizerMeasure}
                                  />
                                  </motion.div>
                              )
                            }

                            return <div key={`spacer-${globalIndex}`} />
                          })}
                        </div>
                      </div>
                    )
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-background/80 p-12 text-center text-sm text-muted-foreground">
                {hasSearch || hasActiveFilters ? (
                  <>
                    <p>No results matched that combination.</p>
                    <p>Try relaxing a filter or using a broader search term.</p>
                    {hasActiveFilters ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Reset filters
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p>The catalog is warming up. Check back shortly.</p>
                    <p>We’re syncing new releases for this region.</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default ProductSearchExperience
