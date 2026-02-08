"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnFiltersState,
  type Column,
  type FilterFn,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  type VirtualizerOptions,
} from "@tanstack/virtual-core"
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import SmartLink from "@/components/ui/smart-link"
import { cn } from "@/lib/ui/cn"
import {
  PillDropdown,
  type PillDropdownOption,
} from "@/components/ui/pill-dropdown"
import type { DiscographyEntry } from "@/lib/data/discography"

type DiscographyTableProps = {
  entries: DiscographyEntry[]
  className?: string
}

const columnHelper = createColumnHelper<DiscographyEntry>()

const availabilityCopy: Record<DiscographyEntry["availability"], string> = {
  in_print: "In print",
  out_of_print: "Out of print",
  preorder: "Pre-order",
  digital_only: "Digital only",
  unknown: "Unknown",
}

const availabilityTone: Record<DiscographyEntry["availability"], string> = {
  in_print: "border-emerald-500/50 text-emerald-200 bg-emerald-500/10",
  out_of_print: "border-muted-foreground/40 text-muted-foreground bg-muted/10",
  preorder: "border-amber-400/50 text-amber-200 bg-amber-500/10",
  digital_only: "border-sky-400/50 text-sky-200 bg-sky-500/10",
  unknown: "border-border/60 text-foreground bg-foreground/5",
}

const releaseDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
})

const getReleaseTimestamp = (entry: DiscographyEntry): number | null => {
  if (entry.releaseDate) {
    const timestamp = Date.parse(entry.releaseDate)
    if (Number.isFinite(timestamp)) {
      return timestamp
    }
  }

  if (entry.releaseYear != null) {
    return Date.UTC(entry.releaseYear, 0, 1)
  }

  return null
}

const formatReleaseDate = (entry: DiscographyEntry): string => {
  if (entry.releaseDate) {
    const parsed = new Date(entry.releaseDate)
    if (!Number.isNaN(parsed.getTime())) {
      return releaseDateFormatter.format(parsed)
    }
  }

  if (entry.releaseYear != null) {
    return String(entry.releaseYear)
  }

  return "—"
}

const globalFilter: FilterFn<DiscographyEntry> = (row, _columnId, filterValue) => {
  const search = (filterValue as string | undefined)?.toLowerCase().trim()
  if (!search) {
    return true
  }

  const { title, artist, slug, catalogNumber, tags } = row.original
  const haystack = [title, artist, slug.artist, slug.album, catalogNumber ?? "", tags.join(" ")]
    .join(" ")
    .toLowerCase()

  return haystack.includes(search)
}

const AvailabilityBadge = ({ availability }: { availability: DiscographyEntry["availability"] }) => (
  <Badge variant="outline" className={availabilityTone[availability]}>
    {availabilityCopy[availability]}
  </Badge>
)

const SortableHeader = ({
  label,
  column,
}: {
  label: string
  column: Column<DiscographyEntry, unknown>
}) => {
  const direction = column.getIsSorted() || false
  const ariaSort: "none" | "ascending" | "descending" =
    direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
  const toggleSorting = column.getToggleSortingHandler()

  return (
    <button
      type="button"
      onClick={toggleSorting ?? (() => {})}
      aria-pressed={direction !== false}
      aria-label={`${label} (${ariaSort})`}
      className="inline-flex items-center gap-2 text-left uppercase tracking-[0.24rem] text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
      {direction === "asc" ? (
        <ArrowUp className="h-4 w-4" />
      ) : direction === "desc" ? (
        <ArrowDown className="h-4 w-4" />
      ) : (
        <ArrowUpDown className="h-4 w-4" />
      )}
    </button>
  )
}

const useElementVirtualizerCompat = (
  options: PartialKeys<
    VirtualizerOptions<Element, Element>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >
) => {
  "use no memo"
  const rerender = useState({})[1]
  const scheduleRef = useRef(false)
  const mountedRef = useRef(true)

  const scheduleRerender = useCallback(() => {
    if (!mountedRef.current || scheduleRef.current) {
      return
    }

    scheduleRef.current = true

    const run = () => {
      scheduleRef.current = false
      if (!mountedRef.current) {
        return
      }
      rerender({})
    }

    if (typeof queueMicrotask === "function") {
      queueMicrotask(run)
      return
    }

    void Promise.resolve().then(run)
  }, [rerender])

  const resolvedOptions: VirtualizerOptions<Element, Element> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, isScrolling) => {
      scheduleRerender()
      options.onChange?.(instance, isScrolling)
    },
  }

  const [instance] = useState(
    () => new Virtualizer<Element, Element>(resolvedOptions)
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

const DiscographyTable = memo(({ entries, className }: DiscographyTableProps) => {
  const [sorting, setSorting] = useState<SortingState>([{ id: "title", desc: false }])
  const [globalFilterValue, setGlobalFilterValue] = useState("")
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [headerStickyTop, setHeaderStickyTop] = useState(0)
  const filtersRef = useRef<HTMLDivElement | null>(null)

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "cover",
        header: "Cover",
        size: 64,
        cell: ({ row }) => (
          <div className="inline-flex items-center justify-center">
            <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/60 bg-muted/10 shadow-[0_12px_30px_-20px_rgba(0,0,0,0.8)]">
              {row.original.coverUrl ? (
                <Image
                  src={row.original.coverUrl}
                  alt={`${row.original.title} artwork`}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[0.65rem] uppercase tracking-[0.28rem] text-muted-foreground">
                  No art
                </div>
              )}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor("title", {
        header: ({ column }) => (
          <SortableHeader
            label="Release"
            column={column}
          />
        ),
        cell: ({ row }) => (
          <div className="min-w-0 space-y-1">
            <span className="block break-words text-sm font-semibold uppercase tracking-[0.25rem] text-foreground">
              {row.original.title}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("artist", {
        header: ({ column }) => (
          <SortableHeader
            label="Artist"
            column={column}
          />
        ),
        cell: ({ row }) => {
          const artist =
            row.original.slug?.artist?.trim() ||
            row.original.artist
          return (
            <span className="block break-words text-sm uppercase tracking-[0.24rem] text-muted-foreground">
              {artist}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.releaseDate, {
        id: "releaseDate",
        header: ({ column }) => (
          <SortableHeader
            label="Release date"
            column={column}
          />
        ),
        cell: ({ row }) => (
          <span className="text-xs tracking-[0.06rem] text-muted-foreground">
            {formatReleaseDate(row.original)}
          </span>
        ),
        sortingFn: (rowA, rowB) => {
          const a = getReleaseTimestamp(rowA.original)
          const b = getReleaseTimestamp(rowB.original)
          if (a == null && b == null) {
            return 0
          }
          if (a == null) {
            return 1
          }
          if (b == null) {
            return -1
          }
          return a === b ? 0 : a > b ? 1 : -1
        },
      }),
      columnHelper.accessor("formats", {
        header: "Format",
        cell: ({ getValue }) => {
          const formats = getValue()
          if (!formats.length) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-wrap gap-2">
              {formats.map((format) => (
                <span
                  key={format}
                  className="max-w-full rounded-full border border-border/60 px-2 py-1 text-[0.65rem] uppercase tracking-[0.24rem] text-muted-foreground"
                >
                  {format}
                </span>
              ))}
            </div>
          )
        },
        filterFn: (row, id, value) => {
          if (!value) {
            return true
          }
          const formats = row.getValue<string[]>(id)
          return formats.some((format) => format.toLowerCase() === (value as string).toLowerCase())
        },
      }),
      columnHelper.accessor("tags", {
        header: "Tags",
        cell: ({ getValue }) => {
          const tags = getValue()
          if (!tags.length) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="max-w-full rounded-full border border-border/60 px-2 py-1 text-[0.65rem] uppercase tracking-[0.2rem] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )
        },
        filterFn: (row, id, value) => {
          if (!value) {
            return true
          }
          const tags = row.getValue<string[]>(id)
          return tags.some((tag) => tag.toLowerCase() === (value as string).toLowerCase())
        },
      }),
      columnHelper.accessor("catalogNumber", {
        header: "Catalog #",
        cell: ({ getValue }) => (
          <span className="text-xs uppercase tracking-[0.24rem] text-muted-foreground">
            {getValue() ?? "—"}
          </span>
        ),
      }),
      columnHelper.accessor("availability", {
        header: ({ column }) => (
          <SortableHeader
            label="Availability"
            column={column}
          />
        ),
        cell: ({ getValue }) => <AvailabilityBadge availability={getValue()} />,
        filterFn: (row, id, value) => {
          if (!value) {
            return true
          }
          return row.getValue<DiscographyEntry["availability"]>(id) === value
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <SmartLink
            href={row.original.productPath}
            nativePrefetch
            className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.24rem] text-muted-foreground transition hover:border-destructive hover:text-destructive"
          >
            View
            <ExternalLink className="h-4 w-4" />
          </SmartLink>
        ),
      }),
    ],
    []
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: entries,
    columns,
    state: {
      sorting,
      globalFilter: globalFilterValue,
      columnFilters,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilterValue,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: globalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const availabilityColumn = table.getColumn("availability")
  const formatColumn = table.getColumn("formats")
  const tagColumn = table.getColumn("tags")

  const handleAvailabilityChange = useCallback(
    (value: string) => availabilityColumn?.setFilterValue(value || undefined),
    [availabilityColumn]
  )

  const handleFormatChange = useCallback(
    (value: string) => formatColumn?.setFilterValue(value || undefined),
    [formatColumn]
  )

  const handleTagChange = useCallback(
    (value: string) => tagColumn?.setFilterValue(value || undefined),
    [tagColumn]
  )

  const formatFilterValue =
    (formatColumn?.getFilterValue() as string | undefined) ?? ""
  const tagFilterValue =
    (tagColumn?.getFilterValue() as string | undefined) ?? ""
  const availabilityFilterValue =
    (availabilityColumn?.getFilterValue() as string | undefined) ?? ""

  const filteredRowCount = table.getFilteredRowModel().rows.length
  const rows = table.getRowModel().rows
  const parentRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useElementVirtualizerCompat({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 132,
    overscan: 8,
  })

  useLayoutEffect(() => {
    const updateHeaderStickyTop = () => {
      const scrollElement = parentRef.current
      const filtersElement = filtersRef.current

      if (!scrollElement || !filtersElement) {
        setHeaderStickyTop(0)
        return
      }

      const hasInternalScroll =
        scrollElement.scrollHeight > scrollElement.clientHeight + 1

      if (hasInternalScroll) {
        setHeaderStickyTop(0)
        return
      }

      const globalHeaderOffset = 64
      setHeaderStickyTop(filtersElement.offsetHeight + globalHeaderOffset)
    }

    updateHeaderStickyTop()

    const scrollElement = parentRef.current
    const filtersElement = filtersRef.current
    const resizeObserver = new ResizeObserver(() => {
      updateHeaderStickyTop()
    })

    if (scrollElement) {
      resizeObserver.observe(scrollElement)
    }

    if (filtersElement) {
      resizeObserver.observe(filtersElement)
    }

    window.addEventListener("resize", updateHeaderStickyTop)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateHeaderStickyTop)
    }
  }, [entries.length, filteredRowCount])

  const availabilityOptions: [PillDropdownOption<DiscographyEntry["availability"] | "">, ...Array<PillDropdownOption<DiscographyEntry["availability"] | "">>] = [
    { value: "", label: "All availability" },
    { value: "in_print", label: "In print" },
    { value: "out_of_print", label: "Out of print" },
    { value: "preorder", label: "Pre-order" },
    { value: "digital_only", label: "Digital only" },
  ]

  const formatDropdownOptions: [PillDropdownOption<string>, ...Array<PillDropdownOption<string>>] =
    [
      { value: "", label: "All formats" },
      { value: "Vinyl", label: "Vinyl" },
      { value: "CD", label: "CD" },
      { value: "Cassette", label: "Cassette" },
    ]

  const tagDropdownOptions = useMemo<
    [PillDropdownOption<string>, ...Array<PillDropdownOption<string>>]
  >(() => {
    const uniqueTags = Array.from(
      new Set(
        entries
          .flatMap((entry) => entry.tags ?? [])
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      )
    ).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    )

    return [
      { value: "", label: "All tags" },
      ...uniqueTags.map((tag) => ({ value: tag, label: tag })),
    ]
  }, [entries])

  return (
    <div
      className={cn(
        "flex h-full min-h-[16rem] flex-col rounded-3xl bg-background/85 p-0",
        className
      )}
    >
      <div
        ref={filtersRef}
        className="sticky top-16 z-30 flex flex-col gap-3 border-b border-border/30 bg-background/95 px-4 pb-3 pt-4 backdrop-blur lg:flex-row lg:flex-wrap lg:items-center lg:justify-between"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
          <div className="space-y-1">
            <Label
              htmlFor="discography-search"
              className="sr-only"
            >
              Search
            </Label>
            <Input
              id="discography-search"
              value={globalFilterValue}
              onChange={(event) => setGlobalFilterValue(event.target.value)}
              placeholder="SEARCH..."
              className="w-full min-w-0 sm:min-w-[260px] lg:min-w-[320px]"
            />
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:ml-4 lg:w-auto">
            <PillDropdown
              value={availabilityFilterValue as DiscographyEntry["availability"] | ""}
              options={availabilityOptions}
              onChange={(value) => handleAvailabilityChange(value)}
              className="w-full sm:min-w-[220px]"
              buttonClassName="w-full sm:min-w-[220px]"
              dropdownClassName="w-full sm:min-w-[220px]"
              renderTriggerLabel={(option) => option.label}
            />
            <PillDropdown
              value={formatFilterValue}
              options={formatDropdownOptions}
              onChange={(value) => handleFormatChange(value)}
              className="w-full sm:min-w-[220px]"
              buttonClassName="w-full sm:min-w-[220px]"
              dropdownClassName="w-full sm:min-w-[220px]"
              renderTriggerLabel={(option) => option.label}
            />
            <PillDropdown
              value={tagFilterValue}
              options={tagDropdownOptions}
              onChange={(value) => handleTagChange(value)}
              className="w-full sm:min-w-[220px]"
              buttonClassName="w-full sm:min-w-[220px]"
              dropdownClassName="w-full sm:min-w-[220px]"
              renderTriggerLabel={(option) => option.label}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.24rem] text-muted-foreground lg:justify-end lg:items-center">
          <span className="whitespace-nowrap">
            Showing {filteredRowCount} filtered · {entries.length} total
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div ref={parentRef} className="h-full min-h-0 overflow-auto">
          {rows.length ? (
            <>
              <div
                className="sticky z-10 hidden border-b border-border/30 bg-background/95 px-5 py-3 text-[0.68rem] uppercase tracking-[0.2rem] text-muted-foreground backdrop-blur md:grid md:grid-cols-[72px_1.55fr_1.05fr_0.9fr_1fr_0.95fr_0.85fr_1fr_0.9fr] md:items-center md:gap-5"
                style={{ top: `${headerStickyTop}px` }}
              >
                <div className="text-left">Cover</div>
                <SortableHeader label="Release" column={table.getColumn("title")!} />
                <SortableHeader label="Artist" column={table.getColumn("artist")!} />
                <SortableHeader label="Release date" column={table.getColumn("releaseDate")!} />
                <div className="text-left">Formats</div>
                <div className="text-left">Tags</div>
                <div className="text-left">Catalog #</div>
                <SortableHeader label="Availability" column={table.getColumn("availability")!} />
                <div className="text-right">Actions</div>
              </div>

              <div
                style={{ height: virtualizer.getTotalSize(), position: "relative" }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  if (!row) {
                    return null
                  }
                  const cellById = Object.fromEntries(
                    row.getVisibleCells().map((cell) => [cell.column.id, cell])
                  )
                  return (
                    <div
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="border-b border-border/30"
                    >
                      <div className="px-4 py-4 md:hidden">
                        <div className="rounded-2xl border border-border/50 bg-background/85 p-4 shadow-[0_18px_35px_-28px_rgba(0,0,0,0.75)]">
                          <div className="flex items-start gap-3">
                            <div className="shrink-0">
                              {cellById.cover
                                ? flexRender(cellById.cover.column.columnDef.cell, cellById.cover.getContext())
                                : null}
                            </div>
                            <div className="min-w-0 flex-1 space-y-3">
                              <div className="space-y-1">
                                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                  Release
                                </p>
                                {cellById.title
                                  ? flexRender(cellById.title.column.columnDef.cell, cellById.title.getContext())
                                  : null}
                              </div>
                              <div className="space-y-1">
                                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                  Artist
                                </p>
                                {cellById.artist
                                  ? flexRender(cellById.artist.column.columnDef.cell, cellById.artist.getContext())
                                  : null}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 space-y-1">
                            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                              Formats
                            </p>
                            {cellById.formats
                              ? flexRender(cellById.formats.column.columnDef.cell, cellById.formats.getContext())
                              : null}
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                Release date
                              </dt>
                              <dd>
                                {cellById.releaseDate
                                  ? flexRender(
                                      cellById.releaseDate.column.columnDef.cell,
                                      cellById.releaseDate.getContext()
                                    )
                                  : null}
                              </dd>
                            </div>
                            <div className="space-y-1">
                              <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                Tags
                              </dt>
                              <dd>
                                {cellById.tags
                                  ? flexRender(cellById.tags.column.columnDef.cell, cellById.tags.getContext())
                                  : null}
                              </dd>
                            </div>
                            <div className="space-y-1">
                              <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                Catalog #
                              </dt>
                              <dd>
                                {cellById.catalogNumber
                                  ? flexRender(
                                      cellById.catalogNumber.column.columnDef.cell,
                                      cellById.catalogNumber.getContext()
                                    )
                                  : null}
                              </dd>
                            </div>
                            <div className="space-y-1">
                              <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                Availability
                              </dt>
                              <dd>
                                {cellById.availability
                                  ? flexRender(
                                      cellById.availability.column.columnDef.cell,
                                      cellById.availability.getContext()
                                    )
                                  : null}
                              </dd>
                            </div>
                            <div className="space-y-1">
                              <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.24rem] text-muted-foreground">
                                Action
                              </dt>
                              <dd className="pt-0.5">
                                {cellById.actions
                                  ? flexRender(cellById.actions.column.columnDef.cell, cellById.actions.getContext())
                                  : null}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>

                      <div className="hidden gap-4 px-5 py-5 md:grid md:grid-cols-[72px_1.55fr_1.05fr_0.9fr_1fr_0.95fr_0.85fr_1fr_0.9fr] md:items-center md:gap-5">
                        <div className="md:flex md:items-center">
                          {cellById.cover ? flexRender(cellById.cover.column.columnDef.cell, cellById.cover.getContext()) : null}
                        </div>
                        <div>
                          {cellById.title ? flexRender(cellById.title.column.columnDef.cell, cellById.title.getContext()) : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.artist ? flexRender(cellById.artist.column.columnDef.cell, cellById.artist.getContext()) : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.releaseDate
                            ? flexRender(cellById.releaseDate.column.columnDef.cell, cellById.releaseDate.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.formats
                            ? flexRender(cellById.formats.column.columnDef.cell, cellById.formats.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.tags
                            ? flexRender(cellById.tags.column.columnDef.cell, cellById.tags.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.catalogNumber
                            ? flexRender(cellById.catalogNumber.column.columnDef.cell, cellById.catalogNumber.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.availability
                            ? flexRender(cellById.availability.column.columnDef.cell, cellById.availability.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center md:justify-end">
                          {cellById.actions
                            ? flexRender(cellById.actions.column.columnDef.cell, cellById.actions.getContext())
                            : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing matches these filters yet. Clear filters or check back when the catalog updates.
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

DiscographyTable.displayName = "DiscographyTable"

export default DiscographyTable
