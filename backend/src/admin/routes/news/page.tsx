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
  useDataTable,
  type DataTablePaginationState,
} from "@medusajs/ui"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"

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
import { hasDiscographyReadAccess } from "../../features/content/content-permissions"
import { replaceLegacyContentLocation } from "../../features/content/content-routes"
import { NewsEditor } from "../../features/news/news-editor"
import type { NewsPublicationIntent } from "../../features/news/news-form-state"
import {
  beginNewsCommand,
  finishNewsCommand,
  newsCommandStorageKey,
  restoreNewsCommand,
  retryNewsCommand,
  scheduleNewsRestore,
  type SavedNewsCommand,
} from "../../features/news/news-command-state"
import { NewsCommandReview } from "../../features/news/news-command-review"
import {
  createNewsEntry,
  listNewsEntries,
  updateNewsLifecycle,
  type NewsEntry,
  type NewsWriteInput,
  type NewsWriteStatus,
} from "../../features/news/news-query"
import { NewsCollection, useNewsColumns } from "../../features/news/news-table"
import {
  AdminRequestError,
  getAdminRequestErrorMessage,
} from "../../lib/admin-request"
import { useAdminPermissions } from "../../lib/admin-permissions"

const PAGE_SIZE = 25
const QUERY_KEY = ["news"] as const

export const NewsSuccessFeedback = memo<{
  message: string
  onDismiss: () => void
}>(({ message, onDismiss }) => (
  <Alert
    aria-label="News confirmation"
    aria-atomic="true"
    aria-live="polite"
    className="mt-5"
    role="status"
    variant="success"
  >
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <Text className="min-w-0 break-words">{message}</Text>
      <Button
        aria-label="Dismiss News confirmation"
        className="min-h-6 min-w-6 shrink-0"
        onClick={onDismiss}
        size="small"
        type="button"
        variant="transparent"
      >
        Dismiss
      </Button>
    </div>
    <Text size="small">
      The saved action is confirmed. The current list may reflect later edits.
    </Text>
  </Alert>
))
NewsSuccessFeedback.displayName = "NewsSuccessFeedback"

export const refreshNewsCollection = async (
  client: QueryClient
): Promise<void> => {
  await client.invalidateQueries(
    { queryKey: QUERY_KEY },
    { throwOnError: true }
  )
  const active = client
    .getQueryCache()
    .findAll({ queryKey: QUERY_KEY, type: "active" })
  if (
    !active.length ||
    active.some(
      (query) =>
        query.state.status !== "success" ||
        query.state.fetchStatus !== "idle" ||
        query.state.isInvalidated
    )
  )
    throw new Error(
      "The current News list could not be refreshed. Keep the confirmed request and try finishing again."
    )
}

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

const restoreFocus = (target: HTMLElement | null): void => {
  globalThis.requestAnimationFrame?.(() => {
    target?.focus()
  })
}

export const restoreNewsFeedbackFocus = (
  target: HTMLElement | null,
  fallback: HTMLElement | null
): void => {
  globalThis.requestAnimationFrame?.(() => {
    const next = target?.isConnected ? target : fallback
    if (next?.isConnected) next.focus()
  })
}

const successMessage = (
  mode: "create" | "edit",
  intent: NewsPublicationIntent,
  previousStatus?: NewsEntry["status"]
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
    return previousStatus === "scheduled"
      ? "Schedule updated"
      : "News post scheduled"
  }
  if (mode === "create") {
    return "Draft saved"
  }
  return previousStatus === "draft" ? "Draft updated" : "Post moved to drafts"
}

const NewsAdminPageContent = memo(() => {
  const permissions = useAdminPermissions()
  const canCreate = permissions.hasPermission(contentAdminActions.news.create)
  const canUpdate = permissions.hasPermission(contentAdminActions.news.update)
  const canUploadCover = permissions.hasPermission(
    nativeAdminActions.file.create
  )
  const canReadDiscography = hasDiscographyReadAccess(permissions.hasPermission)
  const [view, setView] = useState<ArchiveView>("active")
  const [pageIndex, setPageIndex] = useState(0)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sortValue, setSortValue] = useState<SortValue>("updated_at:desc")
  const [createOpen, setCreateOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<NewsEntry | null>(null)
  const [lifecycleEntry, setLifecycleEntry] = useState<NewsEntry | null>(null)
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null)
  const [savedCommand, setSavedCommand] = useState<SavedNewsCommand | null>(
    null
  )
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const recoveryEpoch = useRef(0)
  const mounted = useRef(true)
  const backendOrigin =
    typeof window === "undefined" ? "" : window.location.origin
  const lifecycleIdempotencyKeyRef = useRef(crypto.randomUUID())
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const successDismissTargetRef = useRef<HTMLInputElement>(null)
  const newsWorkspaceTitleRef = useRef<HTMLSpanElement>(null)
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
        signal
      ),
    queryKey: [...QUERY_KEY, view, status, sortValue, query, offset],
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
    await refreshNewsCollection(queryClient)
  }, [queryClient])
  const commandBoundary = useCallback(
    (epoch: number) => ({
      storage: window.localStorage,
      locks: navigator.locks,
      isCurrent: () => mounted.current && recoveryEpoch.current === epoch,
    }),
    []
  )
  const loadSavedCommand = useCallback(async () => {
    const epoch = ++recoveryEpoch.current
    setRecoveryReady(false)
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const saved = await restoreNewsCommand(
        backendOrigin,
        commandBoundary(epoch)
      )
      if (mounted.current && recoveryEpoch.current === epoch) {
        setSavedCommand(saved)
        setRecoveryReady(true)
      }
    } catch (error) {
      if (mounted.current && recoveryEpoch.current === epoch) {
        setSavedCommand(null)
        setRecoveryError(
          getAdminRequestErrorMessage(
            error,
            "The saved News request could not be verified. Keep it for recovery."
          )
        )
      }
    } finally {
      if (mounted.current && recoveryEpoch.current === epoch)
        setRecoveryBusy(false)
    }
  }, [backendOrigin, commandBoundary])
  useEffect(() => {
    mounted.current = true
    const epoch = ++recoveryEpoch.current
    void scheduleNewsRestore(
      () => mounted.current && recoveryEpoch.current === epoch,
      loadSavedCommand
    )
    const onStorage = (event: StorageEvent) => {
      if (event.key === newsCommandStorageKey) void loadSavedCommand()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      mounted.current = false
      ++recoveryEpoch.current
      window.removeEventListener("storage", onStorage)
    }
  }, [loadSavedCommand])
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
    mutationFn: async (
      variables:
        | {
            kind: "new"
            entry: NewsEntry
            idempotencyKey: string
            values: NewsWriteInput
            intent: NewsPublicationIntent
          }
        | { kind: "retry"; record: SavedNewsCommand }
    ) => {
      const epoch = recoveryEpoch.current
      const boundary = commandBoundary(epoch)
      const attempt =
        variables.kind === "retry"
          ? await retryNewsCommand(variables.record, backendOrigin, boundary)
          : await beginNewsCommand(
              { backendOrigin, entryId: variables.entry.id },
              variables.entry,
              variables.values,
              variables.intent,
              variables.idempotencyKey,
              boundary
            )
      if (mounted.current && recoveryEpoch.current === epoch) {
        setSavedCommand(attempt.record)
        setRecoveryError(
          attempt.error
            ? getAdminRequestErrorMessage(
                attempt.error,
                "The News save is unconfirmed. Keep its saved request."
              )
            : null
        )
      }
      if (attempt.record.status !== "confirmed")
        throw (
          attempt.error ??
          new Error("The News save is unconfirmed. Retry the saved request.")
        )
      return { record: attempt.record, epoch }
    },
    onSuccess: async ({ record, epoch }) => {
      if (!mounted.current || recoveryEpoch.current !== epoch)
        throw new AdminRequestError(
          "The News editor changed. Keep its confirmed request.",
          "cancelled"
        )
      // Refresh can fail independently of the durable command. Keep its
      // confirmed envelope until every asynchronous completion step succeeds.
      await finishNewsCommand(
        record,
        backendOrigin,
        commandBoundary(epoch),
        invalidateNews
      )
      if (!mounted.current || recoveryEpoch.current !== epoch) return
      setSavedCommand(null)
      setRecoveryError(null)
      setEditingEntry(null)
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
        idempotencyKey
      ),
    onSuccess: async (_result, variables) => {
      const restored = Boolean(variables.entry.archivedAt)
      const focusTarget = lifecycleTriggerRef.current
      setLifecycleEntry(null)
      setSuccessFeedback(restored ? "News post restored" : "News post archived")
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
      setSearchInput(event.currentTarget.value)
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
    setStatus("all")
    setSortValue("updated_at:desc")
    resetPage()
  }, [resetPage])
  const handleCreateOpen = useCallback(() => {
    setSuccessFeedback(null)
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
      setSuccessFeedback(null)
      formTriggerRef.current = trigger
      updateMutation.reset()
      setEditingEntry(savedCommand?.loadedEntry ?? entry)
    },
    [savedCommand, updateMutation]
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
      setSuccessFeedback(null)
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
      // Keep the confirmation and idempotency key available for an exact retry.
    }
  }, [lifecycleEntry, lifecycleMutation])
  const handleCreateSubmit = useCallback(
    async (
      values: NewsWriteInput,
      idempotencyKey: string,
      intent: NewsPublicationIntent
    ) => {
      await createMutation.mutateAsync({ idempotencyKey, values })
      setSuccessFeedback(successMessage("create", intent))
    },
    [createMutation]
  )
  const handleUpdateSubmit = useCallback(
    async (
      values: NewsWriteInput,
      idempotencyKey: string,
      intent: NewsPublicationIntent
    ) => {
      if (!editingEntry) {
        throw new AdminRequestError(
          "The News editor changed. Keep its saved request.",
          "cancelled"
        )
      }
      await updateMutation.mutateAsync({
        kind: "new",
        entry: editingEntry,
        idempotencyKey,
        values,
        intent,
      })
      setSuccessFeedback(successMessage("edit", intent, editingEntry.status))
    },
    [editingEntry, updateMutation]
  )
  const handleCommandRetry = useCallback(async () => {
    if (!savedCommand || !canUpdate || updateMutation.isPending || recoveryBusy)
      return
    const epoch = recoveryEpoch.current
    try {
      await updateMutation.mutateAsync({ kind: "retry", record: savedCommand })
      setSuccessFeedback(
        successMessage(
          "edit",
          savedCommand.intent,
          savedCommand.loadedEntry.status
        )
      )
    } catch (error) {
      if (mounted.current && recoveryEpoch.current === epoch)
        setRecoveryError(
          getAdminRequestErrorMessage(
            error,
            "The News save remains unconfirmed. Keep its saved request."
          )
        )
    }
  }, [canUpdate, recoveryBusy, savedCommand, updateMutation])
  const handleCommandResolve = useCallback(async () => {
    if (
      !savedCommand ||
      savedCommand.status === "uncertain" ||
      recoveryBusy ||
      updateMutation.isPending
    )
      return
    const epoch = recoveryEpoch.current
    setRecoveryBusy(true)
    try {
      await finishNewsCommand(
        savedCommand,
        backendOrigin,
        commandBoundary(epoch),
        invalidateNews
      )
      if (!mounted.current || recoveryEpoch.current !== epoch) return
      setSavedCommand(null)
      setRecoveryError(null)
      setEditingEntry(null)
      if (savedCommand.status === "confirmed")
        setSuccessFeedback(
          successMessage(
            "edit",
            savedCommand.intent,
            savedCommand.loadedEntry.status
          )
        )
    } catch (error) {
      if (mounted.current && recoveryEpoch.current === epoch)
        setRecoveryError(
          getAdminRequestErrorMessage(
            error,
            "Keep the saved News request for recovery."
          )
        )
    } finally {
      if (mounted.current && recoveryEpoch.current === epoch)
        setRecoveryBusy(false)
    }
  }, [
    backendOrigin,
    commandBoundary,
    invalidateNews,
    recoveryBusy,
    savedCommand,
    updateMutation,
  ])
  const openCommandRecovery = useCallback(() => {
    if (savedCommand) {
      setSuccessFeedback(null)
      setEditingEntry(savedCommand.loadedEntry)
    }
  }, [savedCommand])
  const handleRetry = useCallback(() => {
    void pageQuery.refetch()
  }, [pageQuery])

  const busyEntryId = lifecycleMutation.isPending
    ? (lifecycleMutation.variables?.entry.id ?? null)
    : null
  const columns = useNewsColumns({
    busyEntryId,
    canUpdate: canUpdate && recoveryReady && !savedCommand && !recoveryBusy,
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
  const filtered = Boolean(query || status !== "all")
  const countLabel = `${page.count} ${page.count === 1 ? "post" : "posts"}`
  const pageError = pageQuery.error
    ? getAdminRequestErrorMessage(pageQuery.error, "Unable to load news posts.")
    : null
  const createError = createMutation.error
    ? getAdminRequestErrorMessage(
        createMutation.error,
        "Unable to save the post."
      )
    : null
  const updateError = updateMutation.error
    ? getAdminRequestErrorMessage(
        updateMutation.error,
        "Unable to update the post."
      )
    : null
  const lifecycleError = lifecycleMutation.error
    ? getAdminRequestErrorMessage(
        lifecycleMutation.error,
        "Unable to update this post."
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
                Create post
              </Button>
            ) : null
          }
          description="Draft privately, schedule a future update, or publish immediately. Archived posts remain recoverable."
          status={
            <Text aria-live="polite" className="text-ui-fg-subtle" size="small">
              {pageQuery.isPending ? "Loading…" : countLabel}
            </Text>
          }
          title={
            <span
              id="news-workspace-title"
              ref={newsWorkspaceTitleRef}
              tabIndex={-1}
            >
              News
            </span>
          }
        />
        <ContentWorkspaceNavigation
          active="news"
          className="mt-5"
          showDiscography={canReadDiscography}
        />
        {successFeedback ? (
          <NewsSuccessFeedback
            message={successFeedback}
            onDismiss={() => {
              setSuccessFeedback(null)
              restoreNewsFeedbackFocus(
                successDismissTargetRef.current,
                newsWorkspaceTitleRef.current
              )
            }}
          />
        ) : null}
        <Alert className="mt-5" variant="info">
          <Text weight="plus">Visibility is deliberate</Text>
          <Text size="small">
            Drafts stay private. Scheduled posts appear automatically at their
            chosen time. Archiving hides a post without deleting its history.
          </Text>
        </Alert>
        {!recoveryReady && recoveryError ? (
          <Alert className="mt-5" role="alert" variant="warning">
            <Text size="small">{recoveryError}</Text>
            <Button
              disabled={recoveryBusy || updateMutation.isPending}
              onClick={() => {
                void loadSavedCommand()
              }}
              type="button"
              variant="secondary"
            >
              Check saved News request
            </Button>
          </Alert>
        ) : null}
        {savedCommand ? (
          <Alert className="mt-5" role="status" variant="warning">
            <Text size="small">
              A saved News command needs recovery before another post can be
              edited. Its original request is retained.
            </Text>
            <Button
              disabled={recoveryBusy || updateMutation.isPending}
              onClick={openCommandRecovery}
              type="button"
              variant="secondary"
            >
              Recover saved News request
            </Button>
          </Alert>
        ) : null}
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
              <Tabs.Content className="sr-only" tabIndex={-1} value="active">
                Active news posts
              </Tabs.Content>
              <Tabs.Content className="sr-only" tabIndex={-1} value="archived">
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
                    ref={successDismissTargetRef}
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
            canUpdate={
              canUpdate && recoveryReady && !savedCommand && !recoveryBusy
            }
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
          canUploadCover={canUploadCover}
          error={createError}
          mode="create"
          onClose={handleCreateClose}
          onSubmit={handleCreateSubmit}
          restoreFocusRef={createTriggerRef}
        />
      ) : null}
      {editingEntry ? (
        <NewsEditor
          canUploadCover={canUploadCover}
          entry={editingEntry}
          error={updateError}
          mode="edit"
          locked={!recoveryReady || savedCommand !== null}
          recoveryBusy={recoveryBusy || updateMutation.isPending}
          recovery={
            savedCommand ? (
              <NewsCommandReview
                record={savedCommand}
                error={recoveryError}
                busy={recoveryBusy || updateMutation.isPending}
                canRetry={canUpdate}
                onRetry={() => {
                  void handleCommandRetry()
                }}
                onResolve={() => {
                  void handleCommandResolve()
                }}
              />
            ) : undefined
          }
          onClose={handleEditClose}
          onSubmit={handleUpdateSubmit}
          restoreFocusRef={formTriggerRef}
        />
      ) : null}

      <ConfirmAction
        confirmLabel={
          lifecycleEntry?.archivedAt ? "Restore post" : "Archive post"
        }
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

NewsAdminPageContent.displayName = "NewsAdminPageContent"

export const NewsAdminPage = memo(() => (
  <AdminPermissionBoundary
    actions={contentAdminActions.news.read}
    workspace="News"
  >
    <NewsAdminPageContent />
  </AdminPermissionBoundary>
))

NewsAdminPage.displayName = "NewsAdminPage"

const LegacyNewsPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis
    replaceLegacyContentLocation(location, "news")
  }, [])

  return null
})

LegacyNewsPage.displayName = "LegacyNewsPage"

export default LegacyNewsPage
