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
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
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
  initialSort?: ProductSortOption
  genreFilters: GenreFilterSeed[]
}

const SORT_OPTIONS: Array<PillDropdownOption<ProductSortOption>> = [
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
      renderTriggerLabel={(option) => (
        <>
          {option.Icon ? <option.Icon className="h-4 w-4 text-foreground" aria-hidden /> : null}
          {option.label}
        </>
      )}
      renderOptionLabel={(option) => (
        <span className="flex flex-col text-left leading-tight">
          <span className="flex items-center gap-2">
            {option.Icon ? <option.Icon className="h-4 w-4 text-foreground" aria-hidden /> : null}
            {option.label}
          </span>
          {option.helper ? (
            <span className="text-[0.6rem] uppercase tracking-[0.2rem] text-muted-foreground/80">
              {option.helper}
            </span>
          ) : null}
        </span>
      )}
    />
  )
}

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

  const [catalogHits, setCatalogHits] = useState<ProductSearchHit[]>(initialHits)

  useEffect(() => {
    setCatalogHits(initialHits)
  }, [initialHits])

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
        setCatalogHits(enriched)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [initialHits])

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
    if (typeof window === "undefined") {
      return
    }

    window.scrollTo({ top: 0 })
    virtualizer.scrollToIndex(0, { align: "start" })
  }, [criteriaKey, virtualizer])

  const activeFiltersCount =
    selectedGenres.length +
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
  }, [categoryFacetCounts, normalizedGenreFilters])

  const formatOptions = useMemo(
    () =>
      Object.entries(catalogFacets.variants ?? {})
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
      Object.entries(catalogFacets.productTypes ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({
          value,
          label: formatProductTypeLabel(value),
          count,
        })),
    [catalogFacets.productTypes, formatProductTypeLabel]
  )

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
      <div className="container flex flex-col gap-4 px-2 pt-4 sm:px-4 lg:flex-row lg:gap-8">
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
                          const product = deferredResults[globalIndex]

                          if (product) {
                            return (
                              <div
                                key={`${product.id}-${product.handle ?? product.id}-${globalIndex}`}
                              >
                                <ProductCard product={product} />
                              </div>
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
