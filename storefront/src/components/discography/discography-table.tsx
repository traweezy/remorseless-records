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

const globalFilter: FilterFn<DiscographyEntry> = (row, _columnId, filterValue) => {
  const search = (filterValue as string | undefined)?.toLowerCase().trim()
  if (!search) {
    return true
  }

  const { title, artist, slug, catalogNumber } = row.original
  const haystack = [title, artist, slug.artist, slug.album, catalogNumber ?? ""]
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

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "cover",
        header: "Cover",
        size: 64,
        cell: ({ row }) => (
          <SmartLink
            href={row.original.productPath}
            nativePrefetch
            className="inline-flex items-center justify-center"
          >
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
          </SmartLink>
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
          <div className="space-y-1">
            <SmartLink
              href={row.original.productPath}
              nativePrefetch
              className="text-sm font-semibold uppercase tracking-[0.25rem] text-foreground hover:text-destructive"
            >
              {row.original.title}
            </SmartLink>
            {row.original.collectionTitle ? (
              <div className="text-[0.65rem] uppercase tracking-[0.28rem] text-muted-foreground/70">
                {row.original.collectionTitle}
              </div>
            ) : null}
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
            <span className="text-sm uppercase tracking-[0.24rem] text-muted-foreground">
              {artist}
            </span>
          )
        },
      }),
      columnHelper.accessor("releaseYear", {
        header: ({ column }) => (
          <SortableHeader
            label="Year"
            column={column}
          />
        ),
        cell: ({ getValue }) => (
          <span className="text-xs uppercase tracking-[0.22rem] text-muted-foreground">
            {getValue() ?? "—"}
          </span>
        ),
        sortingFn: (rowA, rowB, columnId) => {
          const a = rowA.getValue<number | null>(columnId)
          const b = rowB.getValue<number | null>(columnId)
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
                  className="rounded-full border border-border/60 px-2 py-1 text-[0.65rem] uppercase tracking-[0.24rem] text-muted-foreground"
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

  const handleAvailabilityChange = useCallback(
    (value: string) => availabilityColumn?.setFilterValue(value || undefined),
    [availabilityColumn]
  )

  const handleFormatChange = useCallback(
    (value: string) => formatColumn?.setFilterValue(value || undefined),
    [formatColumn]
  )

  const formatFilterValue =
    (formatColumn?.getFilterValue() as string | undefined) ?? ""
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

  return (
    <div
      className={cn(
        "flex h-full min-h-[16rem] flex-col rounded-3xl bg-background/85 p-0",
        className
      )}
    >
      <div className="sticky top-16 z-30 flex flex-col gap-3 border-b border-border/30 bg-background/95 px-4 pb-3 pt-4 backdrop-blur lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
          <div className="space-y-1">
            <Label
              htmlFor="discography-search"
              className="text-[0.7rem] uppercase tracking-[0.3rem] text-muted-foreground"
            >
              Search
            </Label>
            <Input
              id="discography-search"
              value={globalFilterValue}
              onChange={(event) => setGlobalFilterValue(event.target.value)}
              placeholder="Search"
              className="w-full min-w-[260px] lg:min-w-[320px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-4">
            <PillDropdown
              value={availabilityFilterValue as DiscographyEntry["availability"] | ""}
              options={availabilityOptions}
              onChange={(value) => handleAvailabilityChange(value)}
              className="min-w-[220px]"
              buttonClassName="min-w-[220px]"
              dropdownClassName="min-w-[220px]"
              renderTriggerLabel={(option) => option.label}
            />
            <PillDropdown
              value={formatFilterValue}
              options={formatDropdownOptions}
              onChange={(value) => handleFormatChange(value)}
              className="min-w-[220px]"
              buttonClassName="min-w-[220px]"
              dropdownClassName="min-w-[220px]"
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
              <div className="sticky top-0 z-10 hidden border-b border-border/30 bg-background/95 px-5 py-3 text-[0.65rem] uppercase tracking-[0.24rem] text-muted-foreground/80 backdrop-blur md:grid md:grid-cols-[72px_1.6fr_1.1fr_0.7fr_1fr_0.9fr_1fr_0.9fr] md:items-center md:gap-5">
                <div className="text-left">Cover</div>
                <SortableHeader label="Release" column={table.getColumn("title")!} />
                <SortableHeader label="Artist" column={table.getColumn("artist")!} />
                <SortableHeader label="Year" column={table.getColumn("releaseYear")!} />
                <div className="text-left">Format</div>
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
                      <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-[72px_1.6fr_1.1fr_0.7fr_1fr_0.9fr_1fr_0.9fr] md:items-center md:gap-5">
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
                          {cellById.releaseYear
                            ? flexRender(cellById.releaseYear.column.columnDef.cell, cellById.releaseYear.getContext())
                            : null}
                        </div>
                        <div className="md:flex md:items-center">
                          {cellById.formats
                            ? flexRender(cellById.formats.column.columnDef.cell, cellById.formats.getContext())
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
