"use client"

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  Input,
  Label,
  Select,
  Tabs,
  Text,
  toast,
  useDataTable,
  type DataTablePaginationState,
} from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ConfirmAction } from "../../components/confirm-action"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { NewsEditor } from "../../features/news/news-editor"
import type { NewsPublicationIntent } from "../../features/news/news-form-state"
import {
  createNewsEntry,
  listNewsEntries,
  updateNewsEntry,
  updateNewsLifecycle,
  type NewsEntry,
  type NewsWriteInput,
  type NewsWriteStatus,
} from "../../features/news/news-query"
import {
  NewsCollection,
  useNewsColumns,
} from "../../features/news/news-table"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"

const PAGE_SIZE = 25
const QUERY_KEY = ["news"] as const

const sortOptions = [
  {
    direction: "desc",
    label: "Recently updated",
    order: "updated_at",
    value: "updated_at:desc",
  },
  {
    direction: "desc",
    label: "Publication date (newest)",
    order: "published_at",
    value: "published_at:desc",
  },
  {
    direction: "asc",
    label: "Publication date (oldest)",
    order: "published_at",
    value: "published_at:asc",
  },
  {
    direction: "desc",
    label: "Recently created",
    order: "created_at",
    value: "created_at:desc",
  },
  {
    direction: "asc",
    label: "Headline A–Z",
    order: "title",
    value: "title:asc",
  },
  {
    direction: "desc",
    label: "Headline Z–A",
    order: "title",
    value: "title:desc",
  },
] as const

type SortValue = (typeof sortOptions)[number]["value"]
type ArchiveView = "active" | "archived"
type StatusFilter = NewsWriteStatus | "all"

const statusOptions: ReadonlyArray<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Published", value: "published" },
]

const isArchiveView = (value: string): value is ArchiveView =>
  value === "active" || value === "archived"

const isStatusFilter = (value: string): value is StatusFilter =>
  statusOptions.some((option) => option.value === value)

const isSortValue = (value: string): value is SortValue =>
  sortOptions.some((option) => option.value === value)

type BrowserEnvironment = typeof globalThis & {
  requestAnimationFrame?: (callback: () => void) => number
}

const restoreFocus = (target: HTMLButtonElement | null): void => {
  const browser = globalThis as BrowserEnvironment
  browser.requestAnimationFrame?.(() => {
    const focusTarget = target as unknown as { focus?: () => void } | null
    focusTarget?.focus?.()
  })
}

const successMessage = (
  mode: "create" | "edit",
  intent: NewsPublicationIntent,
  previousStatus?: NewsEntry["status"],
): string => {
  if (intent === "publish") {
    if (mode === "create") {
      return "News post published"
    }
    return previousStatus === "published"
      ? "Published post updated"
      : "News post published"
  }
  if (intent === "schedule") {
    if (mode === "create") {
      return "News post scheduled"
    }
    return previousStatus === "scheduled" ? "Schedule updated" : "News post scheduled"
  }
  if (mode === "create") {
    return "Draft saved"
  }
  return previousStatus === "draft" ? "Draft updated" : "Post moved to drafts"
}

const NewsAdminPage = memo(() => {
  const [view, setView] = useState<ArchiveView>("active")
  const [pageIndex, setPageIndex] = useState(0)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sortValue, setSortValue] = useState<SortValue>("updated_at:desc")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<NewsEntry | null>(null)
  const [lifecycleEntry, setLifecycleEntry] = useState<NewsEntry | null>(null)
  const lifecycleIdempotencyKeyRef = useRef(crypto.randomUUID())
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const formTriggerRef = useRef<HTMLButtonElement | null>(null)
  const lifecycleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const queryClient = useQueryClient()

  const sort =
    sortOptions.find((option) => option.value === sortValue) ?? sortOptions[0]
  const offset = pageIndex * PAGE_SIZE
  const pageQuery = useQuery({
    queryFn: ({ signal }) =>
      listNewsEntries(
        {
          archived: view,
          direction: sort.direction,
          limit: PAGE_SIZE,
          offset,
          order: sort.order,
          q: query,
          status: view === "archived" ? "all" : status,
        },
        signal,
      ),
    queryKey: [
      ...QUERY_KEY,
      view,
      status,
      sortValue,
      query,
      offset,
    ],
    retry: false,
    staleTime: 10_000,
  })
  const page = pageQuery.data ?? {
    count: 0,
    entries: [],
    limit: PAGE_SIZE,
    offset,
  }

  const invalidateNews = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])
  const createMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      values,
    }: {
      idempotencyKey: string
      values: NewsWriteInput
    }) => createNewsEntry(values, idempotencyKey),
    onSuccess: async () => {
      setCreateOpen(false)
      await invalidateNews()
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({
      entry,
      idempotencyKey,
      values,
    }: {
      entry: NewsEntry
      idempotencyKey: string
      values: NewsWriteInput
    }) => updateNewsEntry(entry, values, idempotencyKey),
    onSuccess: async () => {
      setEditingEntry(null)
      await invalidateNews()
    },
  })
  const lifecycleMutation = useMutation({
    mutationFn: ({
      entry,
      idempotencyKey,
    }: {
      entry: NewsEntry
      idempotencyKey: string
    }) =>
      updateNewsLifecycle(
        entry,
        entry.archivedAt ? "restore" : "archive",
        idempotencyKey,
      ),
    onSuccess: async (_result, variables) => {
      const restored = Boolean(variables.entry.archivedAt)
      const focusTarget = lifecycleTriggerRef.current
      setLifecycleEntry(null)
      toast.success(restored ? "News post restored" : "News post archived")
      if (page.entries.length === 1 && pageIndex > 0) {
        setPageIndex((current) => current - 1)
      }
      await invalidateNews()
      restoreFocus(focusTarget)
    },
  })

  const resetPage = useCallback(() => setPageIndex(0), [])
  const handleViewChange = useCallback((value: string) => {
    if (isArchiveView(value)) {
      setView(value)
      if (value === "archived") {
        setStatus("all")
      }
      setPageIndex(0)
    }
  }, [])
  const handleStatusChange = useCallback((value: string) => {
    if (isStatusFilter(value)) {
      setStatus(value)
      setPageIndex(0)
    }
  }, [])
  const handleSortChange = useCallback((value: string) => {
    if (isSortValue(value)) {
      setSortValue(value)
      setPageIndex(0)
    }
  }, [])
  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = (event.currentTarget as unknown as { value?: unknown }).value
      setSearchInput(typeof value === "string" ? value : "")
    },
    [],
  )
  const applySearch = useCallback(() => {
    setQuery(searchInput.trim())
    resetPage()
  }, [resetPage, searchInput])
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault()
        applySearch()
      }
    },
    [applySearch],
  )
  const clearSearch = useCallback(() => {
    setSearchInput("")
    setQuery("")
    resetPage()
  }, [resetPage])
  const clearAllControls = useCallback(() => {
    setSearchInput("")
    setQuery("")
    setStatus("all")
    setSortValue("updated_at:desc")
    resetPage()
  }, [resetPage])
  const handleCreateOpen = useCallback(() => {
    createMutation.reset()
    setCreateOpen(true)
  }, [createMutation])
  const handleCreateClose = useCallback(() => {
    if (!createMutation.isPending) {
      setCreateOpen(false)
      createMutation.reset()
      restoreFocus(createTriggerRef.current)
    }
  }, [createMutation])
  const handleEdit = useCallback(
    (entry: NewsEntry, trigger: HTMLButtonElement) => {
      formTriggerRef.current = trigger
      updateMutation.reset()
      setEditingEntry(entry)
    },
    [updateMutation],
  )
  const handleEditClose = useCallback(() => {
    if (!updateMutation.isPending) {
      setEditingEntry(null)
      updateMutation.reset()
      restoreFocus(formTriggerRef.current)
    }
  }, [updateMutation])
  const handleLifecycle = useCallback(
    (entry: NewsEntry, trigger: HTMLButtonElement) => {
      lifecycleTriggerRef.current = trigger
      lifecycleIdempotencyKeyRef.current = crypto.randomUUID()
      lifecycleMutation.reset()
      setLifecycleEntry(entry)
    },
    [lifecycleMutation],
  )
  const handleLifecycleCancel = useCallback(() => {
    if (!lifecycleMutation.isPending) {
      const focusTarget = lifecycleTriggerRef.current
      setLifecycleEntry(null)
      lifecycleMutation.reset()
      restoreFocus(focusTarget)
    }
  }, [lifecycleMutation])
  const handleLifecycleConfirm = useCallback(async () => {
    if (!lifecycleEntry || lifecycleMutation.isPending) {
      return
    }
    try {
      await lifecycleMutation.mutateAsync({
        entry: lifecycleEntry,
        idempotencyKey: lifecycleIdempotencyKeyRef.current,
      })
    } catch {
      // Keep the confirmation and idempotency key available for an exact retry.
    }
  }, [lifecycleEntry, lifecycleMutation])
  const handleCreateSubmit = useCallback(
    async (
      values: NewsWriteInput,
      idempotencyKey: string,
      intent: NewsPublicationIntent,
    ) => {
      await createMutation.mutateAsync({ idempotencyKey, values })
      toast.success(successMessage("create", intent))
    },
    [createMutation],
  )
  const handleUpdateSubmit = useCallback(
    async (
      values: NewsWriteInput,
      idempotencyKey: string,
      intent: NewsPublicationIntent,
    ) => {
      if (!editingEntry) {
        return
      }
      await updateMutation.mutateAsync({
        entry: editingEntry,
        idempotencyKey,
        values,
      })
      toast.success(successMessage("edit", intent, editingEntry.status))
    },
    [editingEntry, updateMutation],
  )
  const handleRetry = useCallback(() => {
    void pageQuery.refetch()
  }, [pageQuery])

  const busyEntryId = lifecycleMutation.isPending
    ? (lifecycleMutation.variables?.entry.id ?? null)
    : null
  const columns = useNewsColumns({
    busyEntryId,
    onEdit: handleEdit,
    onLifecycle: handleLifecycle,
  })
  const pagination = useMemo<DataTablePaginationState>(
    () => ({ pageIndex, pageSize: PAGE_SIZE }),
    [pageIndex],
  )
  const handlePaginationChange = useCallback(
    (next: DataTablePaginationState) => setPageIndex(next.pageIndex),
    [],
  )
  const dataTable = useDataTable({
    columns,
    data: page.entries,
    getRowId: (entry) => entry.id,
    isLoading: pageQuery.isPending,
    pagination: {
      onPaginationChange: handlePaginationChange,
      state: pagination,
    },
    rowCount: page.count,
  })
  const filtered = Boolean(query || status !== "all")
  const countLabel = `${page.count} ${page.count === 1 ? "post" : "posts"}`
  const pageError = pageQuery.error
    ? getAdminRequestErrorMessage(pageQuery.error, "Unable to load news posts.")
    : null
  const createError = createMutation.error
    ? getAdminRequestErrorMessage(createMutation.error, "Unable to save the post.")
    : null
  const updateError = updateMutation.error
    ? getAdminRequestErrorMessage(updateMutation.error, "Unable to update the post.")
    : null
  const lifecycleError = lifecycleMutation.error
    ? getAdminRequestErrorMessage(
        lifecycleMutation.error,
        "Unable to update this post.",
      )
    : null

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          actions={
            <Button onClick={handleCreateOpen} ref={createTriggerRef} type="button">
              Create post
            </Button>
          }
          description="Draft privately, schedule a future update, or publish immediately. Archived posts remain recoverable."
          status={
            <Text aria-live="polite" className="text-ui-fg-subtle" size="small">
              {pageQuery.isPending ? "Loading…" : countLabel}
            </Text>
          }
          title="News"
        />
        <Alert className="mt-5" variant="info">
          <Text weight="plus">Visibility is deliberate</Text>
          <Text size="small">
            Drafts stay private. Scheduled posts appear automatically at their chosen time. Archiving hides a post without deleting its history.
          </Text>
        </Alert>
      </Container>

      {pageError ? (
        <AdminRetryState
          message={pageError}
          onRetry={handleRetry}
          retrying={pageQuery.isFetching}
          title="News could not load"
        />
      ) : (
        <Container className="p-0">
          <div className="border-b border-ui-border-base px-6 py-5">
            <Tabs onValueChange={handleViewChange} value={view}>
              <Tabs.List>
                <Tabs.Trigger value="active">Active</Tabs.Trigger>
                <Tabs.Trigger value="archived">Archived</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content className="sr-only" value="active">
                Active news posts
              </Tabs.Content>
              <Tabs.Content className="sr-only" value="archived">
                Archived news posts
              </Tabs.Content>
            </Tabs>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto]">
              <div>
                <Label htmlFor="news-search">Search</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Input
                    autoComplete="off"
                    className="min-w-48 flex-1"
                    id="news-search"
                    onChange={handleSearchChange}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Headline or URL slug"
                    role="searchbox"
                    type="text"
                    value={searchInput}
                  />
                  {searchInput || query ? (
                    <Button onClick={clearSearch} type="button" variant="secondary">
                      Clear
                    </Button>
                  ) : null}
                  <Button
                    disabled={searchInput.trim() === query}
                    onClick={applySearch}
                    type="button"
                    variant="secondary"
                  >
                    Search
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="news-status">Status</Label>
                <Select
                  disabled={view === "archived"}
                  onValueChange={handleStatusChange}
                  value={status}
                >
                  <Select.Trigger className="mt-1 min-w-40" id="news-status">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {statusOptions.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label htmlFor="news-sort">Sort</Label>
                <Select onValueChange={handleSortChange} value={sortValue}>
                  <Select.Trigger className="mt-1 min-w-48" id="news-sort">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {sortOptions.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>

            {filtered ? (
              <div className="mt-3 flex justify-end">
                <Button
                  onClick={clearAllControls}
                  size="small"
                  type="button"
                  variant="transparent"
                >
                  Clear all controls
                </Button>
              </div>
            ) : null}
          </div>

          <NewsCollection
            busyEntryId={busyEntryId}
            dataTable={dataTable}
            entries={page.entries}
            filtered={filtered}
            loading={pageQuery.isPending}
            onEdit={handleEdit}
            onLifecycle={handleLifecycle}
            view={view}
          />
        </Container>
      )}

      {createOpen ? (
        <NewsEditor
          error={createError}
          mode="create"
          onClose={handleCreateClose}
          onSubmit={handleCreateSubmit}
          restoreFocusRef={createTriggerRef}
        />
      ) : null}
      {editingEntry ? (
        <NewsEditor
          entry={editingEntry}
          error={updateError}
          mode="edit"
          onClose={handleEditClose}
          onSubmit={handleUpdateSubmit}
          restoreFocusRef={formTriggerRef}
        />
      ) : null}

      <ConfirmAction
        confirmLabel={lifecycleEntry?.archivedAt ? "Restore post" : "Archive post"}
        description={
          lifecycleEntry?.archivedAt
            ? "The post returns to its previous publication state. If a scheduled time passed while archived, it may become visible immediately."
            : "The post disappears from the storefront but keeps its content, author, URL, publication state, and audit history."
        }
        onCancel={handleLifecycleCancel}
        onConfirm={handleLifecycleConfirm}
        open={lifecycleEntry !== null}
        pending={lifecycleMutation.isPending}
        pendingLabel={lifecycleEntry?.archivedAt ? "Restoring…" : "Archiving…"}
        title={
          lifecycleEntry?.archivedAt
            ? `Restore “${lifecycleEntry.title}”?`
            : `Archive “${lifecycleEntry?.title ?? "this post"}”?`
        }
        variant={lifecycleEntry?.archivedAt ? "confirmation" : "danger"}
      >
        {lifecycleError ? (
          <Alert role="alert" variant="error">
            <Text size="small">{lifecycleError}</Text>
          </Alert>
        ) : null}
      </ConfirmAction>
    </AdminSingleColumnLayout>
  )
})

NewsAdminPage.displayName = "NewsAdminPage"

export const config = defineRouteConfig({
  icon: ArchiveBox,
  label: "News",
})

export default NewsAdminPage
