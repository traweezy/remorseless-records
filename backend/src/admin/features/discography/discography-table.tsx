"use client"

import { memo, useCallback, useMemo, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  Button,
  Skeleton,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  type DataTableColumnDef,
  type DataTableEmptyStateProps,
  type UseDataTableReturn,
} from "@medusajs/ui"

import { AdminEmptyState } from "../../components/admin-empty-state"
import { AdminResponsiveDataTable } from "../../components/admin-responsive-data-table"
import type {
  DiscographyAvailability,
  DiscographyEntry,
} from "./discography-query"

const availabilityLabels: Record<DiscographyAvailability, string> = {
  digital_only: "Digital only",
  in_print: "In print",
  out_of_print: "Out of print",
  preorder: "Pre-order",
  unknown: "Unknown",
}

const columnHelper = createDataTableColumnHelper<DiscographyEntry>()

const formatDate = (value: string | null | undefined): string => {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date)
}

const formatReleaseDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Unknown date"
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date)
}

const releaseDateLabel = (entry: DiscographyEntry): string =>
  entry.releaseDate
    ? formatReleaseDate(entry.releaseDate)
    : entry.releaseYear
      ? String(entry.releaseYear)
      : "Unknown date"

const sourceCopy = (entry: DiscographyEntry): string => {
  if (entry.sourceMode === "manual") {
    return "Independent historical record"
  }
  if (entry.linkHealth === "healthy") {
    return "Product link healthy"
  }
  if (entry.linkHealth === "unpublished") {
    return "Product is not published"
  }
  if (entry.linkHealth === "missing") {
    return "Product is missing"
  }
  return "Product link not checked"
}

type EntryActionsProps = {
  busy: boolean
  canReadProducts: boolean
  canUpdate: boolean
  entry: DiscographyEntry
  onEdit: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
}

const EntryActions = memo<EntryActionsProps>(
  ({ busy, canReadProducts, canUpdate, entry, onEdit, onLifecycle }) => {
    const handleEdit = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onEdit(entry, event.currentTarget)
      },
      [entry, onEdit]
    )
    const handleLifecycle = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onLifecycle(entry, event.currentTarget)
      },
      [entry, onLifecycle]
    )

    return (
      <div className="flex flex-wrap justify-end gap-2">
        {canReadProducts &&
        entry.sourceMode === "catalog_product" &&
        entry.linkHealth === "healthy" &&
        entry.productId ? (
          <Button asChild size="small" variant="secondary">
            <Link to={`/products/${encodeURIComponent(entry.productId)}`}>
              Product
            </Link>
          </Button>
        ) : null}
        {canUpdate && entry.sourceMode === "manual" && !entry.archivedAt ? (
          <Button
            disabled={busy}
            onClick={handleEdit}
            size="small"
            type="button"
            variant="secondary"
          >
            Edit
          </Button>
        ) : null}
        {canUpdate ? (
          <Button
            disabled={busy}
            onClick={handleLifecycle}
            size="small"
            type="button"
            variant={entry.archivedAt ? "primary" : "secondary"}
          >
            {entry.archivedAt ? "Restore" : "Archive"}
          </Button>
        ) : null}
      </div>
    )
  }
)

EntryActions.displayName = "EntryActions"

type UseDiscographyColumnsInput = {
  busyEntryId: string | null
  canReadProducts: boolean
  canUpdate: boolean
  onEdit: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
}

export const useDiscographyColumns = ({
  busyEntryId,
  canReadProducts,
  canUpdate,
  onEdit,
  onLifecycle,
}: UseDiscographyColumnsInput) =>
  useMemo<DataTableColumnDef<DiscographyEntry>[]>(
    () => [
      columnHelper.accessor((entry) => entry.title, {
        cell: ({ row }) => (
          <div className="min-w-56">
            <Text size="small" weight="plus">
              {row.original.title}
            </Text>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              {row.original.artist}
            </Text>
          </div>
        ),
        header: "Release",
        id: "release",
        minSize: 250,
        size: 280,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.sourceMode, {
        cell: ({ row }) => (
          <div className="min-w-40">
            <StatusBadge
              color={row.original.sourceMode === "manual" ? "grey" : "blue"}
            >
              {row.original.sourceMode === "manual"
                ? "Historical"
                : "Store release"}
            </StatusBadge>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              {sourceCopy(row.original)}
            </Text>
          </div>
        ),
        header: "Source",
        id: "source",
        minSize: 180,
        size: 200,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.releaseYear, {
        cell: ({ row }) => (
          <div className="min-w-28">
            <Text size="small">{releaseDateLabel(row.original)}</Text>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              {row.original.catalogNumber ?? "No catalog number"}
            </Text>
          </div>
        ),
        header: "Released",
        id: "released",
        minSize: 140,
        size: 160,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.availability, {
        cell: ({ row }) => (
          <div className="min-w-36">
            <StatusBadge color="grey">
              {availabilityLabels[row.original.availability]}
            </StatusBadge>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              {row.original.formats.length
                ? row.original.formats.join(" · ")
                : "No formats recorded"}
            </Text>
          </div>
        ),
        header: "Availability",
        id: "availability",
        minSize: 170,
        size: 190,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.updatedAt, {
        cell: ({ row }) => (
          <Text className="min-w-24 text-ui-fg-subtle" size="xsmall">
            {formatDate(row.original.updatedAt)}
          </Text>
        ),
        header: "Updated",
        id: "updated",
        minSize: 120,
        size: 130,
      }),
      ...(canReadProducts || canUpdate
        ? [
            columnHelper.display({
              cell: ({ row }) => (
                <EntryActions
                  busy={busyEntryId !== null}
                  canReadProducts={canReadProducts}
                  canUpdate={canUpdate}
                  entry={row.original}
                  onEdit={onEdit}
                  onLifecycle={onLifecycle}
                />
              ),
              header: "Actions",
              id: "actions",
              minSize: 200,
              size: 220,
            }),
          ]
        : []),
    ],
    [busyEntryId, canReadProducts, canUpdate, onEdit, onLifecycle]
  )

type MobileCardProps = EntryActionsProps

const DiscographyMobileCard = memo<MobileCardProps>(
  ({ busy, canReadProducts, canUpdate, entry, onEdit, onLifecycle }) => (
    <li className="border-t border-ui-border-base px-4 py-5 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text className="break-words" size="small" weight="plus">
            {entry.title}
          </Text>
          <Text className="mt-1 break-words text-ui-fg-subtle" size="xsmall">
            {entry.artist}
          </Text>
        </div>
        <StatusBadge color={entry.sourceMode === "manual" ? "grey" : "blue"}>
          {entry.sourceMode === "manual" ? "Historical" : "Store release"}
        </StatusBadge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-ui-fg-subtle txt-compact-xsmall">Released</dt>
          <dd className="mt-1 txt-compact-small">{releaseDateLabel(entry)}</dd>
        </div>
        <div>
          <dt className="text-ui-fg-subtle txt-compact-xsmall">Catalog #</dt>
          <dd className="mt-1 break-words txt-compact-small">
            {entry.catalogNumber ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ui-fg-subtle txt-compact-xsmall">Availability</dt>
          <dd className="mt-1 txt-compact-small">
            {availabilityLabels[entry.availability]}
          </dd>
        </div>
        <div>
          <dt className="text-ui-fg-subtle txt-compact-xsmall">Link health</dt>
          <dd className="mt-1 break-words txt-compact-small">
            {sourceCopy(entry)}
          </dd>
        </div>
      </dl>
      {canReadProducts || canUpdate ? (
        <div className="mt-5 [&>div]:justify-start">
          <EntryActions
            busy={busy}
            canReadProducts={canReadProducts}
            canUpdate={canUpdate}
            entry={entry}
            onEdit={onEdit}
            onLifecycle={onLifecycle}
          />
        </div>
      ) : null}
    </li>
  )
)

DiscographyMobileCard.displayName = "DiscographyMobileCard"

const MobileLoadingCards = memo(() => (
  <ul aria-label="Loading discography releases">
    {Array.from({ length: 4 }, (_, index) => (
      <li
        className="border-t border-ui-border-base px-4 py-5 first:border-t-0"
        key={index}
      >
        <Skeleton className="h-5 w-48 max-w-full" />
        <Skeleton className="mt-2 h-4 w-32 max-w-full" />
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="mt-5 h-8 w-full" />
      </li>
    ))}
  </ul>
))

MobileLoadingCards.displayName = "MobileLoadingCards"

type DiscographyCollectionProps = {
  busyEntryId: string | null
  canReadProducts: boolean
  canUpdate: boolean
  dataTable: UseDataTableReturn<DiscographyEntry>
  entries: DiscographyEntry[]
  filtered: boolean
  loading: boolean
  onEdit: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: DiscographyEntry, trigger: HTMLButtonElement) => void
  view: "active" | "archived"
}

export const DiscographyCollection = memo<DiscographyCollectionProps>(
  ({
    busyEntryId,
    canReadProducts,
    canUpdate,
    dataTable,
    entries,
    filtered,
    loading,
    onEdit,
    onLifecycle,
    view,
  }) => {
    const emptyState = useMemo<DataTableEmptyStateProps>(
      () => ({
        empty: {
          custom: (
            <AdminEmptyState
              description={
                filtered
                  ? "Clear or broaden the current search and filters."
                  : view === "archived"
                    ? "Archived releases remain recoverable here."
                    : "Store releases appear automatically from Products. Add a historical release only when it is not currently sold."
              }
              title={
                filtered
                  ? "No releases match these controls"
                  : view === "archived"
                    ? "No releases are archived"
                    : "No discography releases yet"
              }
            />
          ),
        },
      }),
      [filtered, view]
    )
    const mobile = useMemo<ReactNode>(() => {
      if (loading) {
        return <MobileLoadingCards />
      }
      if (!entries.length) {
        return emptyState.empty?.custom ?? null
      }
      return (
        <ul aria-label="Discography releases">
          {entries.map((entry) => (
            <DiscographyMobileCard
              busy={busyEntryId !== null}
              canReadProducts={canReadProducts}
              canUpdate={canUpdate}
              entry={entry}
              key={entry.id}
              onEdit={onEdit}
              onLifecycle={onLifecycle}
            />
          ))}
        </ul>
      )
    }, [
      busyEntryId,
      canReadProducts,
      canUpdate,
      emptyState.empty,
      entries,
      loading,
      onEdit,
      onLifecycle,
    ])

    return (
      <AdminResponsiveDataTable
        desktopEmptyState={emptyState}
        instance={dataTable}
        mobile={mobile}
        showPagination={loading || entries.length > 0}
      />
    )
  }
)

DiscographyCollection.displayName = "DiscographyCollection"
