"use client"

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
} from "react"
import { Debouncer } from "@tanstack/pacer"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { type VirtualItem, useWindowVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowUp10,
  Check,
  ChevronDown,
  Clock,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import Drawer from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import ProductCard from "@/components/product-card"
import type { ProductSearchHit, RelatedProductSummary } from "@/types/product"
import { humanizeCategoryHandle } from "@/lib/products/categories"
import { cn } from "@/lib/ui/cn"
import {
  PillDropdown,
  type PillDropdownOption,
} from "@/components/ui/pill-dropdown"
import {
  CATALOG_PAGE_SIZE,
  type ProductSearchRequest,
  type ProductSearchResponse,
  type ProductSortOption,
} from "@/lib/search/search"
import { searchProductsBrowser } from "@/lib/search/browser"
import { useCatalogStore } from "@/lib/store/catalog"
import { normalizeFormatValue as baseNormalizeFormat } from "@/lib/search/normalize"
import {
  fetchCatalogFilterOptions,
  fetchCatalogPriceRange,
} from "@/lib/catalog/filters.browser"
import {
  formatProductTypeLabel,
  type CatalogFilterDefinitions,
  type CatalogFilterOption,
  type CatalogPriceRange,
} from "@/lib/catalog/filters"

const deferEffectUpdate = (callback: () => void): (() => void) => {
  let cancelled = false
  const timeout = window.setTimeout(() => {
    if (!cancelled) {
      callback()
    }
  }, 0)

  return () => {
    cancelled = true
    window.clearTimeout(timeout)
  }
}

const normalizeFormatFilterValue = (
  value: string | null | undefined
): string | null => {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed.length) {
    return null
  }

  return baseNormalizeFormat(trimmed) ?? trimmed
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

const CATALOG_SKELETON_KEYS = ["one", "two", "three", "four", "five", "six"]

const deriveCollectionTitle = (hit: ProductSearchHit): string | null => {
  if (
    typeof hit.collectionTitle === "string" &&
    hit.collectionTitle.trim().length
  ) {
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
    const normalized = baseNormalizeFormat(trimmed)
    if (normalized) {
      canonical.add(normalized)
      return
    }
    raw.add(trimmed)
  }

  const sourceArrays = [
    hit.formats,
    hit.variantTitles,
    hit.format ? [hit.format] : [],
  ]

  sourceArrays.forEach((entries) => {
    if (!entries) {
      return
    }
    entries.forEach(add)
  })

  const preferred = canonical.size ? canonical : raw
  return Array.from(preferred)
}

export const mapHitToSummary = (
  hit: ProductSearchHit
): RelatedProductSummary => {
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
    genres:
      (hit.metalGenres?.length ? hit.metalGenres : hit.genres)?.filter(
        (entry): entry is string => Boolean(entry && entry.trim().length)
      ) ?? [],
  }
}

type ProductSearchExperienceProps = {
  initialResponse: ProductSearchResponse
  initialSort?: ProductSortOption
  initialFilterDefinitions?: CatalogFilterDefinitions
}

const CARD_MOTION_PROPS = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: "easeOut" },
} as const

const SORT_OPTIONS: [
  PillDropdownOption<ProductSortOption>,
  ...Array<PillDropdownOption<ProductSortOption>>,
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

type FilterOption = CatalogFilterOption

const FilterCheckboxList = ({
  idPrefix,
  title,
  options,
  selected,
  onToggle,
  variant = "chip",
  normalizeValue = (value: string) => value.trim(),
  defaultOpen = false,
}: {
  idPrefix: string
  title: string
  options: FilterOption[]
  selected: string[]
  onToggle: (value: string) => void
  variant?: "chip" | "plain"
  normalizeValue?: (value: string) => string
  defaultOpen?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const titleId = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const controlsId = `${idPrefix}-${titleId}-filters`

  useEffect(() => {
    if (defaultOpen) {
      return deferEffectUpdate(() => setIsOpen(true))
    }
    return undefined
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
        aria-controls={controlsId}
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
            id={controlsId}
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
                const valueId = normalizedValue
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                const checkboxId = `${idPrefix}-${titleId}-${valueId}`

                return (
                  <label
                    key={normalizedValue}
                    htmlFor={checkboxId}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.18rem] leading-relaxed text-muted-foreground transition hover:text-foreground",
                      variant === "chip"
                        ? cn(
                            "border border-border/60 bg-background/60 hover:border-destructive/70 hover:text-destructive",
                            checked &&
                              "border-destructive bg-destructive/20 text-destructive"
                          )
                        : cn(
                            "hover:text-destructive",
                            checked && "text-destructive"
                          )
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
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
                          checked &&
                            "border-destructive bg-destructive text-background"
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 text-foreground">{label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[0.6rem] text-muted-foreground/80">
                      <span className="sr-only">Catalog total: </span>
                      {count}
                    </span>
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

const formatPrice = (amount: number, currency: string): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100)

const priceInputValue = (amount: number | null): string =>
  amount === null ? "" : String(amount / 100)

const parsePriceInput = (value: string): number | null => {
  if (!value.trim().length) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100)
    : Number.NaN
}

type PriceRangeFilterProps = {
  idPrefix: string
  bounds: CatalogPriceRange | null
  min: number | null
  max: number | null
  onApply: (min: number | null, max: number | null) => void
}

const PriceRangeFilter = memo<PriceRangeFilterProps>(
  ({ idPrefix, bounds, min, max, onApply }) => {
    const controlsId = `${idPrefix}-price-filters`
    const [isOpen, setIsOpen] = useState(min !== null || max !== null)
    const [draftMin, setDraftMin] = useState(priceInputValue(min))
    const [draftMax, setDraftMax] = useState(priceInputValue(max))
    const [error, setError] = useState<string | null>(null)
    const errorId = `${idPrefix}-price-error`

    const handleToggle = useCallback(() => {
      setIsOpen((current) => !current)
    }, [])
    const handleMinimumChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        setDraftMin(event.target.value)
      },
      []
    )
    const handleMaximumChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        setDraftMax(event.target.value)
      },
      []
    )
    const handleInputFocus = useCallback(
      (event: FocusEvent<HTMLInputElement>) => {
        event.currentTarget.select()
      },
      []
    )
    const handleSubmit = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const nextMin = parsePriceInput(draftMin)
        const nextMax = parsePriceInput(draftMax)
        if (
          Number.isNaN(nextMin) ||
          Number.isNaN(nextMax) ||
          (nextMin !== null && nextMax !== null && nextMin > nextMax)
        ) {
          setError("Enter a valid minimum and maximum price.")
          return
        }
        setError(null)
        onApply(nextMin, nextMax)
      },
      [draftMax, draftMin, onApply]
    )
    const handleClear = useCallback(() => {
      setDraftMin("")
      setDraftMax("")
      setError(null)
      onApply(null, null)
    }, [onApply])

    if (!bounds) {
      return null
    }

    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleToggle}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-[0.3rem] text-muted-foreground transition hover:text-foreground"
          aria-expanded={isOpen}
          aria-controls={controlsId}
        >
          <span>Price</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition duration-200",
              isOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        <AnimatePresence initial={false}>
          {isOpen ? (
            <motion.div
              id={controlsId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <form className="space-y-3 px-2" onSubmit={handleSubmit}>
                <p className="text-[0.62rem] leading-relaxed text-muted-foreground/80">
                  Catalog range {formatPrice(bounds.min, bounds.currency)}–
                  {formatPrice(bounds.max, bounds.currency)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[0.62rem] uppercase tracking-[0.18rem] text-muted-foreground">
                    <span>Minimum</span>
                    <span className="flex min-h-11 items-center rounded-lg border border-border/70 bg-background px-3 focus-within:border-destructive">
                      <span aria-hidden>$</span>
                      <input
                        value={draftMin}
                        onChange={handleMinimumChange}
                        onFocus={handleInputFocus}
                        className="min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-foreground outline-none"
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Minimum price in dollars"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                      />
                    </span>
                  </label>
                  <label className="space-y-1 text-[0.62rem] uppercase tracking-[0.18rem] text-muted-foreground">
                    <span>Maximum</span>
                    <span className="flex min-h-11 items-center rounded-lg border border-border/70 bg-background px-3 focus-within:border-destructive">
                      <span aria-hidden>$</span>
                      <input
                        value={draftMax}
                        onChange={handleMaximumChange}
                        onFocus={handleInputFocus}
                        className="min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-foreground outline-none"
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Maximum price in dollars"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                      />
                    </span>
                  </label>
                </div>
                <p
                  id={errorId}
                  className="min-h-4 text-[0.62rem] text-destructive"
                  aria-live="polite"
                >
                  {error}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="submit" variant="outline" size="sm">
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={!draftMin.length && !draftMax.length}
                  >
                    Clear
                  </Button>
                </div>
              </form>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    )
  }
)

PriceRangeFilter.displayName = "PriceRangeFilter"

const FilterSidebar = ({
  idPrefix,
  genres,
  formats,
  productTypes,
  priceRange,
  selectedGenres,
  selectedFormats,
  selectedProductTypes,
  selectedPriceMin,
  selectedPriceMax,
  onToggleGenre,
  onToggleFormat,
  onToggleProductType,
  onApplyPrice,
  onClear,
  showInStockOnly,
  onToggleStock,
}: {
  idPrefix: string
  genres: FilterOption[]
  formats: FilterOption[]
  productTypes: FilterOption[]
  priceRange: CatalogPriceRange | null
  selectedGenres: string[]
  selectedFormats: string[]
  selectedProductTypes: string[]
  selectedPriceMin: number | null
  selectedPriceMax: number | null
  onToggleGenre: (genre: string) => void
  onToggleFormat: (format: string) => void
  onToggleProductType: (type: string) => void
  onApplyPrice: (min: number | null, max: number | null) => void
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
        idPrefix={idPrefix}
        title="Product Types"
        options={productTypes}
        selected={selectedProductTypes}
        onToggle={onToggleProductType}
        variant="plain"
        normalizeValue={(value) => value.trim().toLowerCase()}
        defaultOpen
      />

      <Separator className="border-border/50" />

      <FilterCheckboxList
        idPrefix={idPrefix}
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
        idPrefix={idPrefix}
        title="Formats"
        options={formats}
        selected={selectedFormats}
        onToggle={onToggleFormat}
        variant="plain"
        normalizeValue={(value) => normalizeFormatFilterValue(value) ?? ""}
        defaultOpen={selectedFormats.length > 0}
      />

      <Separator className="border-border/50" />

      <PriceRangeFilter
        key={`${selectedPriceMin ?? "any"}-${selectedPriceMax ?? "any"}`}
        idPrefix={idPrefix}
        bounds={priceRange}
        min={selectedPriceMin}
        max={selectedPriceMax}
        onApply={onApplyPrice}
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
  return (
    <PillDropdown value={value} options={SORT_OPTIONS} onChange={onChange} />
  )
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
  initialResponse,
  initialSort = "title-asc",
  initialFilterDefinitions = {
    genres: [],
    formats: [],
    productTypes: [],
    priceRange: null,
  },
}: ProductSearchExperienceProps) => {
  const filterInstanceId = useId().replace(/:/g, "")
  const genreDefinitionsQuery = useQuery({
    queryKey: ["catalog-filter-options", "genres"],
    queryFn: ({ signal }) => fetchCatalogFilterOptions("genres", { signal }),
    initialData: { options: initialFilterDefinitions.genres },
    initialDataUpdatedAt: 0,
    staleTime: 15 * 60_000,
    retry: 1,
  })
  const formatDefinitionsQuery = useQuery({
    queryKey: ["catalog-filter-options", "formats"],
    queryFn: ({ signal }) => fetchCatalogFilterOptions("formats", { signal }),
    initialData: { options: initialFilterDefinitions.formats },
    initialDataUpdatedAt: 0,
    staleTime: 15 * 60_000,
    retry: 1,
  })
  const productTypeDefinitionsQuery = useQuery({
    queryKey: ["catalog-filter-options", "product-types"],
    queryFn: ({ signal }) =>
      fetchCatalogFilterOptions("product-types", { signal }),
    initialData: { options: initialFilterDefinitions.productTypes },
    initialDataUpdatedAt: 0,
    staleTime: 15 * 60_000,
    retry: 1,
  })
  const priceRangeQuery = useQuery({
    queryKey: ["catalog-filter-options", "price-range"],
    queryFn: ({ signal }) => fetchCatalogPriceRange({ signal }),
    initialData: initialFilterDefinitions.priceRange
      ? { range: initialFilterDefinitions.priceRange }
      : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 15 * 60_000,
    retry: 1,
  })
  const normalizedGenreFilters = useMemo(
    () =>
      genreDefinitionsQuery.data.options
        .map((genre, index) => {
          const handle = genre.value?.trim().toLowerCase() ?? ""
          const label = genre.label?.trim() ?? ""
          if (!handle.length || !label.length) {
            return null
          }
          return { handle, label, rank: index, count: genre.count }
        })
        .filter(
          (
            entry
          ): entry is {
            handle: string
            label: string
            rank: number
            count: number
          } => Boolean(entry)
        )
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
        ),
    [genreDefinitionsQuery.data.options]
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
  const selectedPriceMin = useCatalogStore((state) => state.priceMin)
  const selectedPriceMax = useCatalogStore((state) => state.priceMax)
  const showInStockOnly = useCatalogStore((state) => state.showInStockOnly)
  const sortOption = useCatalogStore((state) => state.sort)

  const setQuery = useCatalogStore((state) => state.setQuery)
  const toggleGenreFilter = useCatalogStore((state) => state.toggleGenre)
  const toggleFormatFilter = useCatalogStore((state) => state.toggleFormat)
  const toggleProductTypeFilter = useCatalogStore(
    (state) => state.toggleProductType
  )
  const toggleStockOnlyFilter = useCatalogStore(
    (state) => state.toggleStockOnly
  )
  const setPriceRange = useCatalogStore((state) => state.setPriceRange)
  const handleClearPrice = useCallback(() => {
    setPriceRange(null, null)
  }, [setPriceRange])
  const setSortOption = useCatalogStore((state) => state.setSort)
  const clearFiltersStore = useCatalogStore((state) => state.clearFilters)
  const hydrateFromParams = useCatalogStore((state) => state.hydrateFromParams)

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [pacedQuery, setPacedQuery] = useState("")
  const measureScheduledRef = useRef(false)
  const queryDebouncer = useMemo(
    () =>
      new Debouncer((value: string) => setPacedQuery(value), {
        key: "catalog-search-query",
        wait: 250,
      }),
    []
  )

  useEffect(() => () => queryDebouncer.cancel(), [queryDebouncer])

  useEffect(() => {
    queryDebouncer.maybeExecute(query.trim())
  }, [query, queryDebouncer])

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
    const nextFormats = Array.from(
      new Set(
        splitCsv(params.getAll("format"))
          .map((value) => normalizeFormatFilterValue(value))
          .filter((value): value is string => Boolean(value))
      )
    )
    const nextProductTypes = splitCsv(params.getAll("type"))
    const parsePriceParam = (value: string | null): number | null => {
      if (value === null || !value.trim().length) {
        return null
      }
      const parsed = Number(value)
      return Number.isFinite(parsed) && parsed >= 0
        ? Math.round(parsed * 100)
        : null
    }
    const nextPriceMin = parsePriceParam(params.get("minPrice"))
    const nextPriceMax = parsePriceParam(params.get("maxPrice"))
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
      priceMin: nextPriceMin,
      priceMax: nextPriceMax,
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
  const priceKey = `${selectedPriceMin ?? ""}-${selectedPriceMax ?? ""}`
  const genreCsvValues = useMemo(
    () =>
      selectedGenres
        .map((value) => value.trim())
        .filter((value) => value.length),
    [selectedGenres]
  )
  const formatCsvValues = useMemo(
    () =>
      selectedFormats
        .map((value) => value.trim())
        .filter((value) => value.length),
    [selectedFormats]
  )
  const productTypeCsvValues = useMemo(
    () =>
      selectedProductTypes
        .map((value) => value.trim())
        .filter((value) => value.length),
    [selectedProductTypes]
  )

  const criteriaKey = useMemo(
    () =>
      [
        pacedQuery,
        genresKey,
        formatsKey,
        productTypesKey,
        priceKey,
        showInStockOnly ? "in-stock" : "all",
        sortOption,
      ].join("|"),
    [
      pacedQuery,
      genresKey,
      formatsKey,
      productTypesKey,
      priceKey,
      showInStockOnly,
      sortOption,
    ]
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
    if (selectedPriceMin !== null) {
      params.set("minPrice", String(selectedPriceMin / 100))
    }
    if (selectedPriceMax !== null) {
      params.set("maxPrice", String(selectedPriceMax / 100))
    }
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
    priceKey,
    showInStockOnly,
    sortOption,
    initialSort,
    genreCsvValues,
    formatCsvValues,
    productTypeCsvValues,
    selectedPriceMin,
    selectedPriceMax,
  ])

  const searchFilters = useMemo<ProductSearchRequest["filters"]>(() => {
    const filters = {
      ...(selectedGenres.length
        ? { genres: selectedGenres.map(getGenreLabelForHandle) }
        : {}),
      ...(selectedFormats.length ? { formats: selectedFormats } : {}),
      ...(selectedProductTypes.length
        ? { productTypes: selectedProductTypes }
        : {}),
      ...(selectedPriceMin !== null || selectedPriceMax !== null
        ? {
            price: {
              ...(selectedPriceMin !== null ? { min: selectedPriceMin } : {}),
              ...(selectedPriceMax !== null ? { max: selectedPriceMax } : {}),
            },
          }
        : {}),
    }
    return Object.keys(filters).length ? filters : undefined
  }, [
    getGenreLabelForHandle,
    selectedFormats,
    selectedGenres,
    selectedProductTypes,
    selectedPriceMin,
    selectedPriceMax,
  ])

  const searchRequest = useMemo<ProductSearchRequest>(
    () => ({
      query: pacedQuery,
      limit: CATALOG_PAGE_SIZE,
      offset: 0,
      sort: sortOption,
      inStockOnly: showInStockOnly,
      ...(searchFilters ? { filters: searchFilters } : {}),
    }),
    [pacedQuery, searchFilters, showInStockOnly, sortOption]
  )

  const isInitialSearch =
    !pacedQuery.length &&
    !selectedGenres.length &&
    !selectedFormats.length &&
    !selectedProductTypes.length &&
    selectedPriceMin === null &&
    selectedPriceMax === null &&
    !showInStockOnly &&
    sortOption === initialSort

  const searchQuery = useInfiniteQuery({
    queryKey: [
      "catalog-products",
      pacedQuery,
      genresKey,
      formatsKey,
      productTypesKey,
      priceKey,
      showInStockOnly,
      sortOption,
    ],
    queryFn: ({ pageParam, signal }) =>
      searchProductsBrowser(
        { ...searchRequest, offset: pageParam },
        { signal }
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore &&
      typeof lastPage.nextOffset === "number" &&
      lastPage.nextOffset > lastPage.offset
        ? lastPage.nextOffset
        : undefined,
    ...(isInitialSearch
      ? { initialData: { pages: [initialResponse], pageParams: [0] } }
      : {}),
    staleTime: 60_000,
    retry: 1,
  })

  const searchPages = useMemo(
    () => searchQuery.data?.pages ?? (isInitialSearch ? [initialResponse] : []),
    [initialResponse, isInitialSearch, searchQuery.data?.pages]
  )
  const activeResponse = searchPages[0]
  const totalResults = activeResponse?.total ?? 0
  const aggregatedHits = useMemo(() => {
    const seenHandles = new Set<string>()
    return searchPages.flatMap((page) =>
      page.hits.filter((hit) => {
        const handle = hit.handle?.trim().toLowerCase()
        if (!handle || seenHandles.has(handle)) {
          return false
        }
        seenHandles.add(handle)
        return true
      })
    )
  }, [searchPages])

  const mappedResults = useMemo(
    () => aggregatedHits.map(mapHitToSummary),
    [aggregatedHits]
  )

  const deferredResults = useDeferredValue(mappedResults)
  const columns = useResponsiveColumns()
  const gridMeasureRef = useRef<HTMLDivElement | null>(null)
  const paginationSentinelRef = useRef<HTMLDivElement | null>(null)
  const lastAutoRequestedResultCountRef = useRef<number | null>(null)
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

  const virtualizer = useWindowVirtualizer({
    count: totalRowCount,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: 0,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useLayoutEffect(() => {
    virtualizer.measure()
    const frame = requestAnimationFrame(() => {
      forceVirtualizerRerender((tick) => tick + 1)
    })
    return () => {
      cancelAnimationFrame(frame)
    }
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
    (selectedPriceMin !== null || selectedPriceMax !== null ? 1 : 0) +
    (showInStockOnly ? 1 : 0)
  const hasSearch = query.trim().length > 0
  const hasActiveFilters = activeFiltersCount > 0

  const filterChipClass =
    "inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16rem] text-foreground shadow-[0_0_15px_rgba(255,0,0,0.18)] transition hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 sm:tracking-[0.25rem]"

  const genreOptions = useMemo(() => {
    type RankedOption = FilterOption & { rank: number }

    const baseOptions: RankedOption[] = normalizedGenreFilters.map((genre) => ({
      value: genre.handle,
      label: genre.label,
      count: genre.count,
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
  }, [normalizedGenreFilters])

  const formatOptions = formatDefinitionsQuery.data.options
  const productTypeOptions = productTypeDefinitionsQuery.data.options
  const priceRange =
    priceRangeQuery.data?.range ?? initialFilterDefinitions.priceRange

  const handleToggleGenre = (genre: string) => {
    const normalizedGenre = genre.trim().toLowerCase()
    if (!normalizedGenre.length) {
      return
    }
    toggleGenreFilter(normalizedGenre)
  }

  const handleToggleFormat = (formatValue: string) => {
    const normalizedFormat = normalizeFormatFilterValue(formatValue)
    if (!normalizedFormat) {
      return
    }
    toggleFormatFilter(normalizedFormat)
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

  const isFetching = searchQuery.isFetching && !searchQuery.isFetchingNextPage
  const fetchNextPage = searchQuery.fetchNextPage
  const refetchSearch = searchQuery.refetch
  const handleRetryNextPage = useCallback(() => {
    void fetchNextPage()
  }, [fetchNextPage])
  const handleRetrySearch = useCallback(() => {
    void refetchSearch()
  }, [refetchSearch])

  useEffect(() => {
    lastAutoRequestedResultCountRef.current = null
  }, [criteriaKey])

  useEffect(() => {
    const sentinel = paginationSentinelRef.current
    if (
      !sentinel ||
      !searchQuery.hasNextPage ||
      searchQuery.isFetchingNextPage ||
      searchQuery.isFetchNextPageError ||
      typeof IntersectionObserver === "undefined"
    ) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        const renderedResultCount = deferredResults.length
        if (lastAutoRequestedResultCountRef.current === renderedResultCount) {
          return
        }

        lastAutoRequestedResultCountRef.current = renderedResultCount
        void fetchNextPage()
      },
      {
        rootMargin: "0px 0px 1200px 0px",
        threshold: 0,
      }
    )

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [
    deferredResults.length,
    fetchNextPage,
    searchQuery.hasNextPage,
    searchQuery.isFetchNextPageError,
    searchQuery.isFetchingNextPage,
  ])

  return (
    <div className="bg-background pb-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pt-4 sm:px-6 lg:flex-row lg:gap-8 lg:px-8">
        <aside className="hidden lg:block lg:w-60 lg:flex-shrink-0">
          <div className="sticky top-24 h-[calc(100vh-7rem)] overflow-y-auto bg-background/90 px-4 py-5 scrollbar-metal supports-[backdrop-filter]:backdrop-blur-xl">
            <FilterSidebar
              idPrefix={`${filterInstanceId}-desktop`}
              genres={genreOptions}
              formats={formatOptions}
              productTypes={productTypeOptions}
              priceRange={priceRange}
              selectedGenres={selectedGenres}
              selectedFormats={selectedFormats}
              selectedProductTypes={selectedProductTypes}
              selectedPriceMin={selectedPriceMin}
              selectedPriceMax={selectedPriceMax}
              onToggleGenre={handleToggleGenre}
              onToggleFormat={handleToggleFormat}
              onToggleProductType={handleToggleProductType}
              onApplyPrice={setPriceRange}
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

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="lg:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border-border/50 px-4 text-xs uppercase tracking-[0.3rem] sm:w-auto sm:justify-start"
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
                  panelClassName="bg-background"
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
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-9 sm:w-9"
                        aria-label="Close filters"
                        onClick={() => setMobileFiltersOpen(false)}
                      >
                        <span className="sr-only">Close filters</span>
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </header>

                    <div className="flex-1 overflow-y-auto px-6 pb-10 pt-2">
                      <FilterSidebar
                        idPrefix={`${filterInstanceId}-mobile`}
                        genres={genreOptions}
                        formats={formatOptions}
                        productTypes={productTypeOptions}
                        priceRange={priceRange}
                        selectedGenres={selectedGenres}
                        selectedFormats={selectedFormats}
                        selectedProductTypes={selectedProductTypes}
                        selectedPriceMin={selectedPriceMin}
                        selectedPriceMax={selectedPriceMax}
                        onToggleGenre={handleToggleGenre}
                        onToggleFormat={handleToggleFormat}
                        onToggleProductType={handleToggleProductType}
                        onApplyPrice={setPriceRange}
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
                        disabled={isFetching}
                      >
                        {isFetching
                          ? "Updating results…"
                          : `Show ${totalResults} results`}
                      </Button>
                    </div>
                  </div>
                </Drawer>
              </div>
              <div className="group flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border/60 bg-background/90 pl-3 pr-0 transition-[border-color,box-shadow] supports-[backdrop-filter]:backdrop-blur-lg hover:border-border focus-within:border-destructive focus-within:shadow-[0_0_0_2px_hsl(var(--destructive)/0.45)] sm:flex-1 sm:min-w-[240px]">
                <Search
                  className="h-4 w-4 text-muted-foreground transition group-focus-within:text-destructive"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  placeholder="Search products and artists…"
                  className="h-9 flex-1 appearance-none border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80 transition-[color] focus:border-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  type="text"
                  role="searchbox"
                  aria-label="Search catalog by product or artist name"
                  autoComplete="off"
                />
                {query.length ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
                    aria-label="Clear catalog search"
                    title="Clear search"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden />
                )}
              </div>
              <div className="w-full sm:w-auto sm:shrink-0">
                <SortDropdown value={sortOption} onChange={setSortOption} />
              </div>
            </div>

            {(selectedGenres.length ||
              selectedFormats.length ||
              selectedProductTypes.length ||
              selectedPriceMin !== null ||
              selectedPriceMax !== null ||
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
                {selectedPriceMin !== null || selectedPriceMax !== null ? (
                  <button
                    type="button"
                    onClick={handleClearPrice}
                    className={filterChipClass}
                  >
                    Price{" "}
                    {selectedPriceMin !== null
                      ? formatPrice(
                          selectedPriceMin,
                          priceRange?.currency ?? "usd"
                        )
                      : "Any"}
                    –
                    {selectedPriceMax !== null
                      ? formatPrice(
                          selectedPriceMax,
                          priceRange?.currency ?? "usd"
                        )
                      : "Any"}{" "}
                    ✕
                  </button>
                ) : null}
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
            {isFetching && deferredResults.length ? (
              <div className="text-sm uppercase tracking-[0.3rem] text-muted-foreground">
                Refreshing results…
              </div>
            ) : null}

            {isFetching && !deferredResults.length ? (
              <div
                className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
                role="status"
                aria-label="Loading catalog results"
              >
                {CATALOG_SKELETON_KEYS.map((key) => (
                  <div key={key} className="space-y-4" aria-hidden="true">
                    <div className="aspect-square rounded-2xl skeleton" />
                    <div className="h-5 w-4/5 rounded-full skeleton" />
                    <div className="h-4 w-2/5 rounded-full skeleton" />
                  </div>
                ))}
                <span className="sr-only">Loading catalog results…</span>
              </div>
            ) : deferredResults.length ? (
              <>
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
                            {Array.from({ length: columns }).map(
                              (_, columnIdx) => {
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
                              }
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </AnimatePresence>
                </div>

                <div
                  ref={paginationSentinelRef}
                  className="flex min-h-24 flex-col items-center justify-center gap-3 pb-8 pt-2 text-center"
                  aria-busy={searchQuery.isFetchingNextPage}
                  aria-live="polite"
                >
                  <p className="text-xs uppercase tracking-[0.25rem] text-muted-foreground">
                    Showing {deferredResults.length} of {totalResults}
                  </p>
                  {searchQuery.isFetchNextPageError ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Couldn&apos;t load more products.
                      </p>
                      <Button
                        variant="outline"
                        onClick={handleRetryNextPage}
                        disabled={searchQuery.isFetchingNextPage}
                      >
                        Try again
                      </Button>
                    </>
                  ) : searchQuery.isFetchingNextPage ? (
                    <p
                      className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
                      role="status"
                    >
                      <LoaderCircle
                        className="h-4 w-4 motion-safe:animate-spin"
                        aria-hidden
                      />
                      Loading more products…
                    </p>
                  ) : searchQuery.hasNextPage ? (
                    <p className="sr-only">
                      More products load automatically as you continue browsing.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      All available products are shown.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-background/80 p-12 text-center text-sm text-muted-foreground">
                {searchQuery.isError ? (
                  <>
                    <p>Search is temporarily unavailable.</p>
                    <p>Your filters are preserved. Try the request again.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetrySearch}
                    >
                      Retry search
                    </Button>
                  </>
                ) : hasSearch || hasActiveFilters ? (
                  <>
                    <p>No results matched that combination.</p>
                    <p>Try relaxing a filter or using a broader search term.</p>
                    {hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearFilters}
                      >
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
