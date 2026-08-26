"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react"
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

import {
  contentAdminActions,
  nativeAdminActions,
} from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { ConfirmAction } from "../../components/confirm-action"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { ContentWorkspaceNavigation } from "../../features/content/content-navigation"
import { discographyReadActions } from "../../features/content/content-permissions"
import {
  replaceLegacyContentLocation,
  type ReplaceContentLocation,
} from "../../features/content/content-routes"
import { DiscographyCollection } from "../../features/discography/discography-table"
import { DiscographyManualForm } from "../../features/discography/discography-manual-form"
import {
  createManualDiscographyEntry,
  discographyAvailabilityValues,
  listDiscographyEntries,
  updateDiscographyLifecycle,
  updateManualDiscographyEntry,
  type DiscographyAvailability,
  type DiscographyEntry,
  type DiscographySourceMode,
  type ManualDiscographyInput,
} from "../../features/discography/discography-query"
import { useDiscographyColumns } from "../../features/discography/discography-table"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import { useAdminPermissions } from "../../lib/admin-permissions"

const PAGE_SIZE = 25
const QUERY_KEY = ["discography"] as const

const sourceOptions: Array<{
  label: string
  value: DiscographySourceMode | "all"
}> = [
  { label: "All sources", value: "all" },
  { label: "Store releases", value: "catalog_product" },
  { label: "Historical records", value: "manual" },
]

const availabilityLabels: Record<DiscographyAvailability, string> = {
  digital_only: "Digital only",
  in_print: "In print",
  out_of_print: "Out of print",
  preorder: "Pre-order",
  unknown: "Unknown",
}

const sortOptions = [
  {
    direction: "desc",
    label: "Newest release",
    order: "release_year",
    value: "release_year:desc",
  },
  {
    direction: "asc",
    label: "Oldest release",
    order: "release_year",
    value: "release_year:asc",
  },
  {
    direction: "asc",
    label: "Release A–Z",
    order: "title",
    value: "title:asc",
  },
  {
    direction: "asc",
    label: "Artist A–Z",
    order: "artist",
    value: "artist:asc",
  },
  {
    direction: "desc",
    label: "Recently updated",
    order: "updated_at",
    value: "updated_at:desc",
  },
] as const

type SortValue = (typeof sortOptions)[number]["value"]
type ArchiveView = "active" | "archived"

const isArchiveView = (value: string): value is ArchiveView =>
  value === "active" || value === "archived"

const isSource = (value: string): value is DiscographySourceMode | "all" =>
  value === "all" || value === "catalog_product" || value === "manual"

const isAvailability = (
  value: string
): value is DiscographyAvailability | "all" =>
  value === "all" ||
  discographyAvailabilityValues.some((candidate) => candidate === value)

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

const DiscographyAdminPageContent = memo(() => {
  const permissions = useAdminPermissions()
  const canCreate = permissions.hasPermission(
    contentAdminActions.discography.create,
  )
  const canUpdate = permissions.hasPermission(
    contentAdminActions.discography.update,
  )
  const canReadNews = permissions.hasPermission(contentAdminActions.news.read)
  const canReadProducts = permissions.hasPermission(
    nativeAdminActions.product.read,
  )
  const [view, setView] = useState<ArchiveView>("active")
  const [pageIndex, setPageIndex] = useState(0)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [sourceMode, setSourceMode] = useState<DiscographySourceMode | "all">(
    "all"
  )
  const [availability, setAvailability] = useState<
    DiscographyAvailability | "all"
  >("all")
  const [sortValue, setSortValue] = useState<SortValue>("release_year:desc")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<DiscographyEntry | null>(
    null
  )
  const [lifecycleEntry, setLifecycleEntry] = useState<DiscographyEntry | null>(
    null
  )
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
      listDiscographyEntries(
        {
          archived: view,
          availability,
          direction: sort.direction,
          limit: PAGE_SIZE,
          offset,
          order: sort.order,
          q: query,
          sourceMode,
        },
        signal
      ),
    queryKey: [
      ...QUERY_KEY,
      view,
      availability,
      sourceMode,
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

  const invalidateDiscography = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  const createMutation = useMutation({
    mutationFn: ({
      idempotencyKey,
      values,
    }: {
      idempotencyKey: string
      values: ManualDiscographyInput
    }) => createManualDiscographyEntry(values, idempotencyKey),
    onSuccess: async () => {
      setCreateOpen(false)
      toast.success("Historical release added")
      await invalidateDiscography()
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({
      entry,
      idempotencyKey,
      values,
    }: {
      entry: DiscographyEntry
      idempotencyKey: string
      values: ManualDiscographyInput
    }) => updateManualDiscographyEntry(entry, values, idempotencyKey),
    onSuccess: async () => {
      setEditingEntry(null)
      toast.success("Historical release updated")
      await invalidateDiscography()
    },
  })
  const lifecycleMutation = useMutation({
    mutationFn: ({
      entry,
      idempotencyKey,
    }: {
      entry: DiscographyEntry
      idempotencyKey: string
    }) =>
      updateDiscographyLifecycle(
        entry,
        entry.archivedAt ? "restore" : "archive",
        idempotencyKey
      ),
    onSuccess: async (_result, variables) => {
      const restored = Boolean(variables.entry.archivedAt)
      const focusTarget = lifecycleTriggerRef.current
      setLifecycleEntry(null)
      toast.success(
        restored ? "Discography release restored" : "Release archived"
      )
      if (page.entries.length === 1 && pageIndex > 0) {
        setPageIndex((current) => current - 1)
      }
      await invalidateDiscography()
      restoreFocus(focusTarget)
    },
  })

  const createError = createMutation.error
    ? getAdminRequestErrorMessage(
        createMutation.error,
        "Unable to add the historical release."
      )
    : null
  const updateError = updateMutation.error
    ? getAdminRequestErrorMessage(
        updateMutation.error,
        "Unable to update the historical release."
      )
    : null
  const lifecycleError = lifecycleMutation.error
    ? getAdminRequestErrorMessage(
        lifecycleMutation.error,
        "Unable to update this release."
      )
    : null

  const resetPage = useCallback(() => setPageIndex(0), [])
  const handleViewChange = useCallback((value: string) => {
    if (isArchiveView(value)) {
      setView(value)
      setPageIndex(0)
    }
  }, [])
  const handleSourceChange = useCallback((value: string) => {
    if (isSource(value)) {
      setSourceMode(value)
      setPageIndex(0)
    }
  }, [])
  const handleAvailabilityChange = useCallback((value: string) => {
    if (isAvailability(value)) {
      setAvailability(value)
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
      const value = (event.currentTarget as unknown as { value?: unknown })
        .value
      setSearchInput(typeof value === "string" ? value : "")
    },
    []
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
    [applySearch]
  )
  const clearSearch = useCallback(() => {
    setSearchInput("")
    setQuery("")
    resetPage()
  }, [resetPage])
  const clearAllControls = useCallback(() => {
    setSearchInput("")
    setQuery("")
    setSourceMode("all")
    setAvailability("all")
    setSortValue("release_year:desc")
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
    (entry: DiscographyEntry, trigger: HTMLButtonElement) => {
      formTriggerRef.current = trigger
      updateMutation.reset()
      setEditingEntry(entry)
    },
    [updateMutation]
  )
  const handleEditClose = useCallback(() => {
    if (!updateMutation.isPending) {
      setEditingEntry(null)
      updateMutation.reset()
      restoreFocus(formTriggerRef.current)
    }
  }, [updateMutation])
  const handleLifecycle = useCallback(
    (entry: DiscographyEntry, trigger: HTMLButtonElement) => {
      lifecycleTriggerRef.current = trigger
      lifecycleIdempotencyKeyRef.current = crypto.randomUUID()
      lifecycleMutation.reset()
      setLifecycleEntry(entry)
    },
    [lifecycleMutation]
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
      // The open confirmation renders the mutation error and keeps the same
      // idempotency key available for an exact retry.
    }
  }, [lifecycleEntry, lifecycleMutation])
  const handleCreateSubmit = useCallback(
    async (values: ManualDiscographyInput, idempotencyKey: string) => {
      await createMutation.mutateAsync({ idempotencyKey, values })
    },
    [createMutation]
  )
  const handleUpdateSubmit = useCallback(
    async (values: ManualDiscographyInput, idempotencyKey: string) => {
      if (!editingEntry) {
        return
      }
      await updateMutation.mutateAsync({
        entry: editingEntry,
        idempotencyKey,
        values,
      })
    },
    [editingEntry, updateMutation]
  )
  const handleRetry = useCallback(() => {
    void pageQuery.refetch()
  }, [pageQuery])

  const busyEntryId = lifecycleMutation.isPending
    ? (lifecycleMutation.variables?.entry.id ?? null)
    : null
  const columns = useDiscographyColumns({
    busyEntryId,
    canReadProducts,
    canUpdate,
    onEdit: handleEdit,
    onLifecycle: handleLifecycle,
  })
  const pagination = useMemo<DataTablePaginationState>(
    () => ({ pageIndex, pageSize: PAGE_SIZE }),
    [pageIndex]
  )
  const handlePaginationChange = useCallback(
    (next: DataTablePaginationState) => setPageIndex(next.pageIndex),
    []
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
  const filtered = Boolean(
    query || sourceMode !== "all" || availability !== "all"
  )
  const countLabel = `${page.count} ${page.count === 1 ? "release" : "releases"}`
  const pageError = pageQuery.error
    ? getAdminRequestErrorMessage(
        pageQuery.error,
        "Unable to load the discography."
      )
    : null

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          actions={
            canCreate ? (
              <Button
                onClick={handleCreateOpen}
                ref={createTriggerRef}
                type="button"
              >
                Add historical release
              </Button>
            ) : null
          }
          description="Store releases synchronize from Products. Use historical records for label releases that are not currently sold."
          status={
            <Text aria-live="polite" className="text-ui-fg-subtle" size="small">
              {pageQuery.isPending ? "Loading…" : countLabel}
            </Text>
          }
          title="Discography"
        />
        <ContentWorkspaceNavigation
          active="discography"
          className="mt-5"
          showNews={canReadNews}
        />
        <Alert className="mt-5" variant="info">
          <Text weight="plus">One source of truth for store releases</Text>
          <Text size="small">
            Edit titles, artists, formats, artwork, and availability on the
            Product. This page keeps the read-only discography projection in
            sync and prevents duplicate storefront links.
          </Text>
        </Alert>
      </Container>

      {pageError ? (
        <AdminRetryState
          message={pageError}
          onRetry={handleRetry}
          retrying={pageQuery.isFetching}
          title="Discography could not load"
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
                Active discography releases
              </Tabs.Content>
              <Tabs.Content className="sr-only" value="archived">
                Archived discography releases
              </Tabs.Content>
            </Tabs>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto]">
              <div>
                <Label htmlFor="discography-search">Search</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    autoComplete="off"
                    id="discography-search"
                    onChange={handleSearchChange}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Release title or artist"
                    role="searchbox"
                    type="text"
                    value={searchInput}
                  />
                  {searchInput || query ? (
                    <Button
                      onClick={clearSearch}
                      type="button"
                      variant="secondary"
                    >
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
                <Label htmlFor="discography-source">Source</Label>
                <Select onValueChange={handleSourceChange} value={sourceMode}>
                  <Select.Trigger
                    className="mt-1 min-w-40"
                    id="discography-source"
                  >
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {sourceOptions.map((option) => (
                      <Select.Item key={option.value} value={option.value}>
                        {option.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label htmlFor="discography-availability">Availability</Label>
                <Select
                  onValueChange={handleAvailabilityChange}
                  value={availability}
                >
                  <Select.Trigger
                    className="mt-1 min-w-40"
                    id="discography-availability"
                  >
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="all">All availability</Select.Item>
                    {discographyAvailabilityValues.map((value) => (
                      <Select.Item key={value} value={value}>
                        {availabilityLabels[value]}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>

              <div>
                <Label htmlFor="discography-sort">Sort</Label>
                <Select onValueChange={handleSortChange} value={sortValue}>
                  <Select.Trigger
                    className="mt-1 min-w-40"
                    id="discography-sort"
                  >
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

          <DiscographyCollection
            busyEntryId={busyEntryId}
            canReadProducts={canReadProducts}
            canUpdate={canUpdate}
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
        <DiscographyManualForm
          error={createError}
          mode="create"
          onClose={handleCreateClose}
          onSubmit={handleCreateSubmit}
          restoreFocusRef={createTriggerRef}
        />
      ) : null}

      {editingEntry ? (
        <DiscographyManualForm
          entry={editingEntry}
          error={updateError}
          key={`${editingEntry.id}:${editingEntry.version}`}
          mode="edit"
          onClose={handleEditClose}
          onSubmit={handleUpdateSubmit}
          restoreFocusRef={formTriggerRef}
        />
      ) : null}

      {lifecycleEntry ? (
        <ConfirmAction
          confirmLabel={
            lifecycleEntry.archivedAt ? "Restore release" : "Archive release"
          }
          description={
            lifecycleEntry.archivedAt
              ? "Restore this release to the active discography. Storefront purchase links still depend on a healthy published Product."
              : "Remove this release from the customer discography without deleting its history. It can be restored later."
          }
          onCancel={handleLifecycleCancel}
          onConfirm={handleLifecycleConfirm}
          open
          pending={lifecycleMutation.isPending}
          pendingLabel={lifecycleEntry.archivedAt ? "Restoring…" : "Archiving…"}
          title={`${lifecycleEntry.archivedAt ? "Restore" : "Archive"} ${lifecycleEntry.title}?`}
          variant={lifecycleEntry.archivedAt ? "confirmation" : "danger"}
        >
          {lifecycleError ? (
            <Alert role="alert" variant="error">
              <Text size="small">{lifecycleError}</Text>
            </Alert>
          ) : null}
        </ConfirmAction>
      ) : null}
    </AdminSingleColumnLayout>
  )
})

DiscographyAdminPageContent.displayName = "DiscographyAdminPageContent"

export const DiscographyAdminPage = memo(() => (
  <AdminPermissionBoundary
    actions={discographyReadActions}
    workspace="Discography"
  >
    <DiscographyAdminPageContent />
  </AdminPermissionBoundary>
))

DiscographyAdminPage.displayName = "DiscographyAdminPage"

const LegacyDiscographyPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis as unknown as {
      location: ReplaceContentLocation
    }
    replaceLegacyContentLocation(location, "discography")
  }, [])

  return null
})

LegacyDiscographyPage.displayName = "LegacyDiscographyPage"

export default LegacyDiscographyPage
