"use client"

import { memo, useCallback, useMemo, type ReactNode } from "react"
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
import type { NewsEntry, NewsStatus } from "./news-query"

const statusColor = {
  archived: "grey",
  draft: "grey",
  published: "green",
  scheduled: "orange",
} as const

const statusLabel: Record<NewsStatus, string> = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
  scheduled: "Scheduled",
}

const formatDate = (value: string | null | undefined): string => {
  if (!value) {
    return "—"
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "—"
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed)
}

const publicationCopy = (entry: NewsEntry): string => {
  if (entry.archivedAt) {
    return `Archived ${formatDate(entry.archivedAt)}`
  }
  if (entry.status === "scheduled") {
    return `Goes live ${formatDate(entry.publishedAt)}`
  }
  if (entry.status === "published") {
    return `Live since ${formatDate(entry.publishedAt)}`
  }
  return "Private to administrators"
}

type EntryActionsProps = {
  busy: boolean
  canUpdate: boolean
  entry: NewsEntry
  onEdit: (entry: NewsEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: NewsEntry, trigger: HTMLButtonElement) => void
}

const EntryActions = memo<EntryActionsProps>(
  ({ busy, canUpdate, entry, onEdit, onLifecycle }) => {
    const handleEdit = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onEdit(entry, event.currentTarget)
      },
      [entry, onEdit],
    )
    const handleLifecycle = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onLifecycle(entry, event.currentTarget)
      },
      [entry, onLifecycle],
    )
    return canUpdate ? (
      <div className="flex flex-wrap justify-end gap-2">
        {!entry.archivedAt ? (
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
        <Button
          disabled={busy}
          onClick={handleLifecycle}
          size="small"
          type="button"
          variant={entry.archivedAt ? "primary" : "secondary"}
        >
          {entry.archivedAt ? "Restore" : "Archive"}
        </Button>
      </div>
    ) : null
  },
)

EntryActions.displayName = "EntryActions"

const columnHelper = createDataTableColumnHelper<NewsEntry>()

type UseNewsColumnsInput = {
  busyEntryId: string | null
  canUpdate: boolean
  onEdit: (entry: NewsEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: NewsEntry, trigger: HTMLButtonElement) => void
}

export const useNewsColumns = ({
  busyEntryId,
  canUpdate,
  onEdit,
  onLifecycle,
}: UseNewsColumnsInput) =>
  useMemo<DataTableColumnDef<NewsEntry>[]>(
    () => [
      columnHelper.accessor((entry) => entry.title, {
        cell: ({ row }) => (
          <div className="min-w-56">
            <Text className="break-words" size="small" weight="plus">
              {row.original.title}
            </Text>
            <Text className="mt-1 break-words text-ui-fg-subtle" size="xsmall">
              {row.original.author ? `By ${row.original.author}` : "Author unavailable"}
            </Text>
          </div>
        ),
        header: "Post",
        id: "post",
        minSize: 260,
        size: 320,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.status, {
        cell: ({ row }) => (
          <div className="min-w-48">
            <StatusBadge color={statusColor[row.original.status]}>
              {statusLabel[row.original.status]}
            </StatusBadge>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              {publicationCopy(row.original)}
            </Text>
          </div>
        ),
        header: "Visibility",
        id: "status",
        minSize: 220,
        size: 250,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.tags, {
        cell: ({ row }) => (
          <Text className="min-w-40 break-words text-ui-fg-subtle" size="xsmall">
            {row.original.tags.length ? row.original.tags.join(" · ") : "No tags"}
          </Text>
        ),
        header: "Tags",
        id: "tags",
        minSize: 180,
        size: 220,
        truncateTooltip: false,
      }),
      columnHelper.accessor((entry) => entry.updatedAt, {
        cell: ({ row }) => (
          <Text className="min-w-32 text-ui-fg-subtle" size="xsmall">
            {formatDate(row.original.updatedAt)}
          </Text>
        ),
        header: "Updated",
        id: "updated",
        minSize: 150,
        size: 170,
      }),
      ...(canUpdate
        ? [
            columnHelper.display({
              cell: ({ row }) => (
                <EntryActions
                  busy={busyEntryId !== null}
                  canUpdate={canUpdate}
                  entry={row.original}
                  onEdit={onEdit}
                  onLifecycle={onLifecycle}
                />
              ),
              header: "Actions",
              id: "actions",
              minSize: 190,
              size: 210,
            }),
          ]
        : []),
    ],
    [busyEntryId, canUpdate, onEdit, onLifecycle],
  )

const NewsMobileCard = memo<EntryActionsProps>(
  ({ busy, canUpdate, entry, onEdit, onLifecycle }) => (
    <li className="border-t border-ui-border-base px-4 py-5 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text className="break-words" size="small" weight="plus">
            {entry.title}
          </Text>
          <Text className="mt-1 break-words text-ui-fg-subtle" size="xsmall">
            {entry.author ? `By ${entry.author}` : "Author unavailable"}
          </Text>
        </div>
        <StatusBadge color={statusColor[entry.status]}>
          {statusLabel[entry.status]}
        </StatusBadge>
      </div>
      <Text className="mt-3 text-ui-fg-subtle" size="xsmall">
        {publicationCopy(entry)}
      </Text>
      {entry.tags.length ? (
        <Text className="mt-1 break-words text-ui-fg-subtle" size="xsmall">
          {entry.tags.join(" · ")}
        </Text>
      ) : null}
      {canUpdate ? (
        <div className="mt-4">
          <EntryActions
            busy={busy}
            canUpdate={canUpdate}
            entry={entry}
            onEdit={onEdit}
            onLifecycle={onLifecycle}
          />
        </div>
      ) : null}
    </li>
  ),
)

NewsMobileCard.displayName = "NewsMobileCard"

const MobileLoadingCards = memo(() => (
  <div aria-label="Loading news posts" aria-live="polite">
    {Array.from({ length: 4 }, (_, index) => (
      <div className="border-t border-ui-border-base px-4 py-5 first:border-t-0" key={index}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="mt-4 h-8 w-full" />
      </div>
    ))}
  </div>
))

MobileLoadingCards.displayName = "MobileLoadingCards"

type NewsCollectionProps = {
  busyEntryId: string | null
  canUpdate: boolean
  dataTable: UseDataTableReturn<NewsEntry>
  entries: NewsEntry[]
  filtered: boolean
  loading: boolean
  onEdit: (entry: NewsEntry, trigger: HTMLButtonElement) => void
  onLifecycle: (entry: NewsEntry, trigger: HTMLButtonElement) => void
  view: "active" | "archived"
}

export const NewsCollection = memo<NewsCollectionProps>(
  ({
    busyEntryId,
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
                  ? "Clear or broaden the current search and status controls."
                  : view === "archived"
                    ? "Archived posts remain recoverable here."
                    : "Create a draft, schedule an update, or publish the label’s first post."
              }
              title={
                filtered
                  ? "No posts match these controls"
                  : view === "archived"
                    ? "No posts are archived"
                    : "No news posts yet"
              }
            />
          ),
        },
      }),
      [filtered, view],
    )
    const mobile = useMemo<ReactNode>(() => {
      if (loading) {
        return <MobileLoadingCards />
      }
      if (!entries.length) {
        return emptyState.empty?.custom ?? null
      }
      return (
        <ul aria-label="News posts">
          {entries.map((entry) => (
            <NewsMobileCard
              busy={busyEntryId !== null}
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
  },
)

NewsCollection.displayName = "NewsCollection"
