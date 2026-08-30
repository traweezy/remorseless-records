"use client"

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Image from "next/image"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
  ChevronRight,
  Search,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CollectionFilterTrigger } from "@/components/ui/collection-filter-trigger"
import Drawer, {
  DrawerCloseButton,
  DrawerEyebrow,
  DrawerHeader,
  DrawerHeading,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  PillDropdown,
  type PillDropdownOption,
} from "@/components/ui/pill-dropdown"
import SmartLink from "@/components/ui/smart-link"
import type { DiscographyEntry } from "@/lib/data/discography"
import { cn } from "@/lib/ui/cn"

type DiscographyTableProps = {
  entries: DiscographyEntry[]
  className?: string
}

type DiscographySort =
  | "catalog-desc"
  | "title-asc"
  | "title-desc"
  | "artist-asc"
  | "newest"
  | "oldest"

export type DiscographyFilters = {
  availability: DiscographyEntry["availability"] | ""
  format: string
  query: string
  tag: string
}

const availabilityCopy: Record<DiscographyEntry["availability"], string> = {
  in_print: "In print",
  out_of_print: "Out of print",
  preorder: "Pre-order",
  digital_only: "Digital only",
  unknown: "Unknown",
}

const availabilityTone: Record<DiscographyEntry["availability"], string> = {
  in_print: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  out_of_print: "border-muted-foreground/40 bg-muted/10 text-muted-foreground",
  preorder: "border-amber-400/50 bg-amber-500/10 text-amber-200",
  digital_only: "border-sky-400/50 bg-sky-500/10 text-sky-200",
  unknown: "border-border/60 bg-foreground/5 text-foreground",
}

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const catalogNumberCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
})

const normalizeCatalogNumber = (value: string | null): string | null => {
  const normalized = value?.trim()
  return normalized?.length ? normalized : null
}

const normalizedText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()

const releaseTimestamp = (entry: DiscographyEntry): number | null => {
  if (entry.releaseDate) {
    const timestamp = Date.parse(entry.releaseDate)
    if (Number.isFinite(timestamp)) {
      return timestamp
    }
  }

  return entry.releaseYear == null ? null : Date.UTC(entry.releaseYear, 0, 1)
}

const formatReleaseDate = (entry: DiscographyEntry): string => {
  if (entry.releaseDate) {
    const parsed = new Date(entry.releaseDate)
    if (!Number.isNaN(parsed.getTime())) {
      return releaseDateFormatter.format(parsed)
    }
  }

  return entry.releaseYear == null
    ? "Date unavailable"
    : String(entry.releaseYear)
}

const matchesExact = (values: string[], selected: string): boolean => {
  if (!selected) {
    return true
  }
  const normalizedSelected = normalizedText(selected)
  return values.some((value) => normalizedText(value) === normalizedSelected)
}

export const filterDiscographyEntries = (
  entries: DiscographyEntry[],
  filters: DiscographyFilters
): DiscographyEntry[] => {
  const query = normalizedText(filters.query)

  return entries.filter((entry) => {
    if (filters.availability && entry.availability !== filters.availability) {
      return false
    }
    if (!matchesExact(entry.formats, filters.format)) {
      return false
    }
    if (!matchesExact(entry.tags, filters.tag)) {
      return false
    }
    if (!query) {
      return true
    }

    return normalizedText(
      [
        entry.title,
        entry.artist,
        entry.album,
        entry.slug.artist,
        entry.slug.album,
        entry.catalogNumber ?? "",
        entry.collectionTitle ?? "",
        ...entry.tags,
      ].join(" ")
    ).includes(query)
  })
}

const compareNullableTimestamp = (
  left: DiscographyEntry,
  right: DiscographyEntry,
  direction: "asc" | "desc"
): number => {
  const leftTimestamp = releaseTimestamp(left)
  const rightTimestamp = releaseTimestamp(right)
  if (leftTimestamp === null && rightTimestamp === null) {
    return left.title.localeCompare(right.title)
  }
  if (leftTimestamp === null) {
    return 1
  }
  if (rightTimestamp === null) {
    return -1
  }
  const difference = leftTimestamp - rightTimestamp
  return direction === "asc" ? difference : -difference
}

export const sortDiscographyEntries = (
  entries: DiscographyEntry[],
  sort: DiscographySort
): DiscographyEntry[] =>
  entries.toSorted((left, right) => {
    switch (sort) {
      case "catalog-desc": {
        const leftCatalog = normalizeCatalogNumber(left.catalogNumber)
        const rightCatalog = normalizeCatalogNumber(right.catalogNumber)
        if (!leftCatalog && !rightCatalog) {
          return (
            left.artist.localeCompare(right.artist) ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id)
          )
        }
        if (!leftCatalog) return 1
        if (!rightCatalog) return -1
        return (
          catalogNumberCollator.compare(rightCatalog, leftCatalog) ||
          left.artist.localeCompare(right.artist) ||
          left.title.localeCompare(right.title) ||
          left.id.localeCompare(right.id)
        )
      }
      case "title-desc":
        return right.title.localeCompare(left.title)
      case "artist-asc":
        return (
          left.artist.localeCompare(right.artist) ||
          left.title.localeCompare(right.title)
        )
      case "newest":
        return compareNullableTimestamp(left, right, "desc")
      case "oldest":
        return compareNullableTimestamp(left, right, "asc")
      default:
        return left.title.localeCompare(right.title)
    }
  })

const uniqueOptions = (
  entries: DiscographyEntry[],
  selector: (entry: DiscographyEntry) => string[]
): string[] =>
  Array.from(
    new Map(
      entries
        .flatMap(selector)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [normalizedText(value), value] as const)
    ).values()
  ).toSorted((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  )

const toOptions = (
  allLabel: string,
  values: string[]
): [PillDropdownOption<string>, ...Array<PillDropdownOption<string>>] => [
  { value: "", label: allLabel },
  ...values.map((value) => ({ value, label: value })),
]

const availabilityOptions: [
  PillDropdownOption<DiscographyEntry["availability"] | "">,
  ...Array<PillDropdownOption<DiscographyEntry["availability"] | "">>,
] = [
  { value: "", label: "All availability" },
  ...Object.entries(availabilityCopy).map(([value, label]) => ({
    value: value as DiscographyEntry["availability"],
    label,
  })),
]

const sortOptions: [
  PillDropdownOption<DiscographySort>,
  ...Array<PillDropdownOption<DiscographySort>>,
] = [
  { value: "catalog-desc", label: "Catalog # high–low", Icon: ArrowDown01 },
  { value: "title-asc", label: "Title A–Z", Icon: ArrowDownAZ },
  { value: "title-desc", label: "Title Z–A", Icon: ArrowUpAZ },
  { value: "artist-asc", label: "Artist A–Z", Icon: ArrowDownAZ },
  { value: "newest", label: "Newest", Icon: CalendarArrowDown },
  { value: "oldest", label: "Oldest", Icon: CalendarArrowUp },
]

const AvailabilityBadge = memo(
  ({ availability }: { availability: DiscographyEntry["availability"] }) => (
    <Badge variant="outline" className={availabilityTone[availability]}>
      {availabilityCopy[availability]}
    </Badge>
  )
)

AvailabilityBadge.displayName = "AvailabilityBadge"

const Cover = memo(({ entry }: { entry: DiscographyEntry }) => {
  const [imageFailed, setImageFailed] = useState(false)
  const handleImageError = useCallback(() => setImageFailed(true), [])
  const coverUrl = imageFailed ? null : entry.coverUrl

  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted/10 shadow-[0_12px_30px_-20px_rgba(0,0,0,0.8)] lg:h-16 lg:w-16">
      {coverUrl ? (
        <Image
          src={coverUrl}
          alt={entry.coverAltText ?? `${entry.title} cover artwork`}
          fill
          sizes="(min-width: 1024px) 64px, 56px"
          className="object-cover"
          onError={handleImageError}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.08rem] text-muted-foreground"
          aria-label={`${entry.title} has no cover artwork`}
          role="img"
        >
          No art
        </div>
      )}
    </div>
  )
})

Cover.displayName = "Cover"

const FormatList = memo(({ formats }: { formats: string[] }) =>
  formats.length ? (
    <div className="flex flex-wrap gap-1.5">
      {formats.map((format) => (
        <Badge key={format} variant="outline" className="whitespace-nowrap">
          {format}
        </Badge>
      ))}
    </div>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  )
)

FormatList.displayName = "FormatList"

const DiscographyRow = memo(
  ({ entry, rowIndex }: { entry: DiscographyEntry; rowIndex: number }) => {
    const mobileContent = (
      <>
        <div>
          <Cover entry={entry} />
        </div>
        <div className="min-w-0 self-center">
          <p className="break-words text-sm font-semibold uppercase tracking-[0.08rem] text-foreground">
            {entry.title}
          </p>
          <p className="mt-1 break-words text-xs uppercase tracking-[0.1rem] text-muted-foreground">
            {entry.artist}
          </p>
        </div>
        {entry.productPath ? (
          <ChevronRight
            className="h-5 w-5 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-destructive"
            aria-hidden
          />
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/30 pt-2 text-xs text-muted-foreground",
            entry.productPath ? "col-span-3" : "col-span-2"
          )}
        >
          <span>{formatReleaseDate(entry)}</span>
          <FormatList formats={entry.formats} />
          {entry.catalogNumber ? (
            <span className="uppercase tracking-[0.12rem]">
              {entry.catalogNumber}
            </span>
          ) : null}
          <AvailabilityBadge availability={entry.availability} />
        </div>
      </>
    )

    return (
      <div
        role="listitem"
        aria-posinset={rowIndex + 1}
        data-testid="discography-row"
      >
        {entry.productPath ? (
          <SmartLink
            href={entry.productPath}
            nativePrefetch
            className="group mx-2 my-1.5 grid min-h-28 grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-2xl border border-border/45 bg-background/80 p-3 transition-[border-color,background-color,box-shadow] hover:border-destructive/60 hover:bg-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
            aria-label={`View ${entry.title} by ${entry.artist}`}
          >
            {mobileContent}
          </SmartLink>
        ) : (
          <div className="mx-2 my-1.5 grid min-h-28 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-2xl border border-border/45 bg-background/80 p-3 lg:hidden">
            {mobileContent}
          </div>
        )}

        <div className="hidden min-h-24 grid-cols-[64px_minmax(10rem,1.8fr)_minmax(6rem,0.85fr)_minmax(7rem,1fr)_minmax(6rem,0.7fr)_minmax(7rem,0.8fr)_auto] items-center gap-3 border-b border-border/30 px-4 py-4 lg:grid">
          <div>
            <Cover entry={entry} />
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold uppercase tracking-[0.12rem] text-foreground">
              {entry.title}
            </p>
            <p className="mt-1 break-words text-xs uppercase tracking-[0.12rem] text-muted-foreground">
              {entry.artist}
            </p>
            {entry.tags.length ? (
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">
                {entry.tags.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatReleaseDate(entry)}
          </div>
          <div>
            <FormatList formats={entry.formats} />
          </div>
          <div className="text-xs uppercase tracking-[0.18rem] text-muted-foreground">
            {entry.catalogNumber ?? "—"}
          </div>
          <div>
            <AvailabilityBadge availability={entry.availability} />
          </div>
          <div className="justify-self-end">
            {entry.productPath ? (
              <Button asChild variant="outlined" size="compact">
                <SmartLink href={entry.productPath} nativePrefetch>
                  View
                </SmartLink>
              </Button>
            ) : (
              <span className="text-right text-xs text-muted-foreground">
                Discography only
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }
)

DiscographyRow.displayName = "DiscographyRow"

const DiscographyTable = memo(
  ({ entries, className }: DiscographyTableProps) => {
    const [query, setQuery] = useState("")
    const [availability, setAvailability] =
      useState<DiscographyFilters["availability"]>("")
    const [format, setFormat] = useState("")
    const [tag, setTag] = useState("")
    const [sort, setSort] = useState<DiscographySort>("catalog-desc")
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
    const [desktopFiltersVisible, setDesktopFiltersVisible] = useState(true)
    const [scrollMargin, setScrollMargin] = useState(0)
    const listRef = useRef<HTMLDivElement | null>(null)

    const formatOptions = useMemo(
      () =>
        toOptions(
          "All formats",
          uniqueOptions(entries, (entry) => entry.formats)
        ),
      [entries]
    )
    const tagOptions = useMemo(
      () =>
        toOptions(
          "All tags",
          uniqueOptions(entries, (entry) => entry.tags)
        ),
      [entries]
    )

    const filters = useMemo<DiscographyFilters>(
      () => ({ availability, format, query, tag }),
      [availability, format, query, tag]
    )
    const visibleEntries = useMemo(
      () =>
        sortDiscographyEntries(
          filterDiscographyEntries(entries, filters),
          sort
        ),
      [entries, filters, sort]
    )

    const virtualizer = useWindowVirtualizer({
      count: visibleEntries.length,
      estimateSize: () => 132,
      overscan: 8,
      scrollMargin,
    })

    const updateScrollMargin = useCallback(() => {
      const list = listRef.current
      if (!list || typeof window === "undefined") {
        return
      }
      const nextMargin = list.getBoundingClientRect().top + window.scrollY
      setScrollMargin((current) =>
        Math.abs(current - nextMargin) > 0.5 ? nextMargin : current
      )
    }, [])

    // biome-ignore lint/correctness/useExhaustiveDependencies: The item count intentionally retriggers measurement after filtering.
    useLayoutEffect(() => {
      updateScrollMargin()
      const list = listRef.current
      if (!list || typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", updateScrollMargin)
        return () => window.removeEventListener("resize", updateScrollMargin)
      }

      const observer = new ResizeObserver(updateScrollMargin)
      observer.observe(list)
      if (list.parentElement) {
        observer.observe(list.parentElement)
      }
      window.addEventListener("resize", updateScrollMargin)
      return () => {
        observer.disconnect()
        window.removeEventListener("resize", updateScrollMargin)
      }
    }, [updateScrollMargin, visibleEntries.length])

    const activeFilterCount =
      (availability ? 1 : 0) + (format ? 1 : 0) + (tag ? 1 : 0)
    const hasAnyConstraint = Boolean(query.trim() || activeFilterCount)

    const clearFilters = useCallback(() => {
      setAvailability("")
      setFormat("")
      setTag("")
    }, [])
    const openMobileFilters = useCallback(() => setMobileFiltersOpen(true), [])
    const toggleDesktopFilters = useCallback(
      () => setDesktopFiltersVisible((visible) => !visible),
      []
    )

    const resultCopy =
      visibleEntries.length === entries.length
        ? `${entries.length} releases`
        : `Showing ${visibleEntries.length} of ${entries.length}`

    return (
      <div
        className={cn(
          "relative min-h-[16rem] rounded-3xl border border-border/50 bg-background/70",
          className
        )}
        role="region"
        aria-label="Remorseless Records discography"
      >
        <header className="sticky top-16 z-30 overflow-visible rounded-t-3xl border-b border-border/40 bg-background shadow-[0_12px_30px_-24px_rgba(0,0,0,0.9)]">
          <div className="flex flex-col gap-2 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="h-11 min-w-0 flex-1 basis-[12rem] gap-2 pl-3 pr-0 sm:basis-[18rem]">
                <InputGroupAddon>
                  <Search className="h-4 w-4" aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search releases and artists…"
                  type="search"
                  role="searchbox"
                  aria-label="Search discography"
                  autoComplete="off"
                />
                {query ? (
                  <InputGroupButton
                    type="button"
                    onClick={() => setQuery("")}
                    className="h-11 w-11 rounded-full"
                    aria-label="Clear discography search"
                    title="Clear search"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </InputGroupButton>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden />
                )}
              </InputGroup>

              <CollectionFilterTrigger
                activeCount={activeFilterCount}
                className="lg:hidden"
                expanded={mobileFiltersOpen}
                iconOnly
                onClick={openMobileFilters}
              />

              <div className="hidden lg:block">
                <CollectionFilterTrigger
                  activeCount={activeFilterCount}
                  controlsId="discography-desktop-filters"
                  expanded={desktopFiltersVisible}
                  mode="sidebar"
                  onClick={toggleDesktopFilters}
                />
              </div>

              <PillDropdown
                value={sort}
                options={sortOptions}
                onChange={setSort}
                ariaLabel="Sort discography"
                className="flex-1 sm:flex-none"
                buttonClassName="sm:min-w-[180px]"
                dropdownClassName="sm:min-w-[220px]"
                compactOnMobile
              />

              <div
                id="discography-desktop-filters"
                className={cn(
                  "hidden items-center gap-2 lg:flex",
                  !desktopFiltersVisible && "lg:hidden"
                )}
              >
                <PillDropdown
                  value={availability}
                  options={availabilityOptions}
                  onChange={setAvailability}
                  ariaLabel="Filter by availability"
                  buttonClassName="sm:min-w-[190px]"
                  dropdownClassName="sm:min-w-[220px]"
                />
                <PillDropdown
                  value={format}
                  options={formatOptions}
                  onChange={setFormat}
                  ariaLabel="Filter by format"
                  buttonClassName="sm:min-w-[170px]"
                  dropdownClassName="sm:min-w-[220px]"
                />
                <PillDropdown
                  value={tag}
                  options={tagOptions}
                  onChange={setTag}
                  ariaLabel="Filter by tag"
                  buttonClassName="sm:min-w-[170px]"
                  dropdownClassName="sm:min-w-[220px]"
                />
              </div>
            </div>

            <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.12rem] text-muted-foreground sm:tracking-[0.18rem]">
              <span aria-live="polite">{resultCopy}</span>
              {activeFilterCount ? (
                <Button
                  type="button"
                  variant="unstyled"
                  size="auto"
                  onClick={clearFilters}
                  className="min-h-6 text-destructive hover:text-foreground"
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>

          <div
            data-testid="discography-table-header"
            className="hidden grid-cols-[64px_minmax(10rem,1.8fr)_minmax(6rem,0.85fr)_minmax(7rem,1fr)_minmax(6rem,0.7fr)_minmax(7rem,0.8fr)_auto] items-center gap-3 border-t border-border/35 bg-surface/80 px-4 py-3 text-[0.7rem] font-semibold uppercase tracking-[0.16rem] text-muted-foreground lg:grid"
          >
            <span>Cover</span>
            <span>Release / artist</span>
            <span>Release date</span>
            <span>Formats</span>
            <span>Catalog #</span>
            <span>Availability</span>
            <span className="text-right">Details</span>
          </div>
        </header>

        <Drawer
          open={mobileFiltersOpen}
          onOpenChange={setMobileFiltersOpen}
          side="left"
          ariaLabel="Discography filters"
          maxWidthClassName="max-w-[360px]"
          panelClassName="bg-background"
        >
          <div className="flex h-full flex-col overflow-hidden">
            <DrawerHeader>
              <DrawerHeading>
                <DrawerEyebrow>Discography</DrawerEyebrow>
                <DrawerTitle className="font-sans text-lg font-semibold tracking-[0.2rem]">
                  Filter releases
                </DrawerTitle>
              </DrawerHeading>
              <DrawerCloseButton label="Close discography filters" />
            </DrawerHeader>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">
              <PillDropdown
                value={availability}
                options={availabilityOptions}
                onChange={setAvailability}
                ariaLabel="Filter by availability"
                className="w-full"
                buttonClassName="w-full"
                dropdownClassName="w-full"
              />
              <PillDropdown
                value={format}
                options={formatOptions}
                onChange={setFormat}
                ariaLabel="Filter by format"
                className="w-full"
                buttonClassName="w-full"
                dropdownClassName="w-full"
              />
              <PillDropdown
                value={tag}
                options={tagOptions}
                onChange={setTag}
                ariaLabel="Filter by tag"
                className="w-full"
                buttonClassName="w-full"
                dropdownClassName="w-full"
              />
            </div>
            <div className="space-y-2 border-t border-border/60 px-6 py-4">
              {activeFilterCount ? (
                <Button
                  type="button"
                  variant="outlined"
                  className="w-full"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              ) : null}
              <Button
                type="button"
                variant="filled"
                className="w-full"
                onClick={() => setMobileFiltersOpen(false)}
              >
                Show {visibleEntries.length} releases
              </Button>
            </div>
          </div>
        </Drawer>

        {visibleEntries.length ? (
          <div
            ref={listRef}
            role="list"
            aria-label={`${visibleEntries.length} discography releases`}
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = visibleEntries[virtualRow.index]
              if (!entry) {
                return null
              }

              return (
                <div
                  key={entry.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${
                      virtualRow.start - scrollMargin
                    }px)`,
                  }}
                >
                  <DiscographyRow entry={entry} rowIndex={virtualRow.index} />
                </div>
              )
            })}
          </div>
        ) : (
          <Empty className="m-4 min-h-52">
            <EmptyHeader>
              <EmptyTitle>No matching releases</EmptyTitle>
              <EmptyDescription>
                {hasAnyConstraint
                  ? "Try a broader search or clear the active filters."
                  : "The discography is waiting for its first release."}
              </EmptyDescription>
            </EmptyHeader>
            {hasAnyConstraint ? (
              <EmptyContent>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    setQuery("")
                    clearFilters()
                  }}
                >
                  Clear search and filters
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>
    )
  }
)

DiscographyTable.displayName = "DiscographyTable"

export default DiscographyTable
