"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { Photo } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  Skeleton,
  StatusBadge,
  Tabs,
  Text,
  createDataTableColumnHelper,
  toast,
  useDataTable,
  type DataTableEmptyStateProps,
  type DataTablePaginationState,
} from "@medusajs/ui"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"

import { operationsAdminActions } from "../../../lib/admin-permissions"
import { AdminEmptyState } from "../../components/admin-empty-state"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { AdminResponsiveDataTable } from "../../components/admin-responsive-data-table"
import { OperationsWorkspaceNavigation } from "../../features/operations/operations-navigation"
import {
  replaceLegacyOperationsLocation,
  type ReplaceAdminLocation,
} from "../../features/operations/operations-routes"
import { useAdminPermissions } from "../../lib/admin-permissions"
import {
  getAdminRequestErrorMessage,
  requestAdminJson,
} from "../../lib/admin-request"

const PAGE_SIZE = 25
const ORPHAN_MEDIA_QUERY_KEY = ["catalog-media-orphans"] as const

const mediaAssetSchema = z.object({
  byteSize: z.number().nullable(),
  createdAt: z.string().nullable().optional(),
  id: z.string(),
  lifecycleStatus: z.enum(["active", "quarantined"]),
  mimeType: z.string().nullable(),
  originalFilename: z.string().nullable(),
  purgeEligibleAt: z.string().nullable(),
  quarantinedAt: z.string().nullable(),
  quarantinedBy: z.string().nullable(),
  sourceFileKey: z.string().nullable(),
  sourceUrl: z.string(),
  version: z.number().int().min(1),
})

const orphanPageSchema = z.object({
  assets: z.array(mediaAssetSchema),
  count: z.number().int().min(0),
  hasMore: z.boolean(),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
})

const lifecycleResponseSchema = z.object({
  asset: mediaAssetSchema,
})

type MediaAsset = z.infer<typeof mediaAssetSchema>
type LifecycleStatus = MediaAsset["lifecycleStatus"]
type OrphanPage = z.infer<typeof orphanPageSchema>

const mediaColumnHelper = createDataTableColumnHelper<MediaAsset>()

const emptyPage = (offset = 0): OrphanPage => ({
  assets: [],
  count: 0,
  hasMore: false,
  limit: PAGE_SIZE,
  offset,
})

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
    timeStyle: "short",
  }).format(date)
}

const formatBytes = (value: number | null): string => {
  if (value === null) {
    return "Unknown size"
  }
  if (value < 1_024) {
    return `${value} B`
  }
  if (value < 1_024 * 1_024) {
    return `${(value / 1_024).toFixed(1)} KiB`
  }
  return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`
}

const isLifecycleStatus = (value: string): value is LifecycleStatus =>
  value === "active" || value === "quarantined"

const AssetPreview = memo<{ asset: MediaAsset }>(({ asset }) => {
  const [failed, setFailed] = useState(false)
  const handleError = useCallback(() => {
    setFailed(true)
  }, [])
  const canPreview = Boolean(asset.sourceFileKey) && !failed

  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle">
      {canPreview ? (
        <img
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
          decoding="async"
          loading="lazy"
          onError={handleError}
          referrerPolicy="no-referrer"
          src={asset.sourceUrl}
        />
      ) : (
        <Photo aria-hidden="true" className="text-ui-fg-muted" />
      )}
    </div>
  )
})

AssetPreview.displayName = "AssetPreview"

type MediaActionProps = {
  asset: MediaAsset
  busy: boolean
  disabled: boolean
  onAction: (asset: MediaAsset) => void
}

const MediaActionButton = memo<MediaActionProps>(
  ({ asset, busy, disabled, onAction }) => {
    const handleAction = useCallback(() => {
      onAction(asset)
    }, [asset, onAction])
    const quarantined = asset.lifecycleStatus === "quarantined"

    return (
      <Button
        aria-label={`${quarantined ? "Restore" : "Quarantine"} ${asset.originalFilename ?? asset.id}`}
        disabled={disabled}
        isLoading={busy}
        onClick={handleAction}
        size="small"
        variant={quarantined ? "primary" : "secondary"}
      >
        {quarantined ? "Restore" : "Quarantine"}
      </Button>
    )
  },
)

MediaActionButton.displayName = "MediaActionButton"

type UseMediaColumnsOptions = {
  busyAssetId: string | null
  canManage: boolean
  onAction: (asset: MediaAsset) => void
}

const useMediaColumns = ({
  busyAssetId,
  canManage,
  onAction,
}: UseMediaColumnsOptions) =>
  useMemo(() => {
    const columns = [
      mediaColumnHelper.accessor((asset) => asset.originalFilename ?? asset.id, {
        cell: ({ row }) => {
          const asset = row.original
          return (
            <div className="flex min-w-64 items-center gap-3">
              <AssetPreview asset={asset} />
              <div className="min-w-0">
                <Text className="truncate" size="small" weight="plus">
                  {asset.originalFilename ?? asset.id}
                </Text>
                <Text
                  className="max-w-72 truncate text-ui-fg-subtle"
                  size="xsmall"
                  title={asset.sourceUrl}
                >
                  {asset.sourceUrl}
                </Text>
              </div>
            </div>
          )
        },
        header: "Asset",
        id: "asset",
        minSize: 320,
        size: 360,
        truncateTooltip: false,
      }),
      mediaColumnHelper.accessor((asset) => asset.sourceFileKey, {
        cell: ({ row }) => {
          const asset = row.original
          return (
            <div className="flex min-w-32 flex-col gap-1">
              <StatusBadge color={asset.sourceFileKey ? "green" : "grey"}>
                {asset.sourceFileKey ? "Managed" : "External"}
              </StatusBadge>
              <Text className="text-ui-fg-subtle" size="xsmall">
                {asset.mimeType ?? "Unknown type"} ·{" "}
                {formatBytes(asset.byteSize)}
              </Text>
            </div>
          )
        },
        header: "Storage",
        id: "storage",
        minSize: 170,
        size: 190,
        truncateTooltip: false,
      }),
      mediaColumnHelper.accessor((asset) => asset.lifecycleStatus, {
        cell: ({ row }) => {
          const asset = row.original
          const quarantined = asset.lifecycleStatus === "quarantined"
          return (
            <div className="flex min-w-36 flex-col gap-1">
              <StatusBadge color={quarantined ? "orange" : "blue"}>
                {quarantined ? "Quarantined" : "Needs review"}
              </StatusBadge>
              <Text className="text-ui-fg-subtle" size="xsmall">
                {quarantined
                  ? `Since ${formatDate(asset.quarantinedAt)}`
                  : `Created ${formatDate(asset.createdAt)}`}
              </Text>
              {quarantined ? (
                <Text
                  className="max-w-44 truncate text-ui-fg-subtle"
                  size="xsmall"
                  title={asset.quarantinedBy ?? undefined}
                >
                  By {asset.quarantinedBy ?? "unknown operator"}
                </Text>
              ) : null}
            </div>
          )
        },
        header: "Status",
        id: "status",
        minSize: 190,
        size: 210,
        truncateTooltip: false,
      }),
      mediaColumnHelper.accessor((asset) => asset.purgeEligibleAt, {
        cell: ({ row }) => {
          const asset = row.original
          const quarantined = asset.lifecycleStatus === "quarantined"
          return (
            <div className="min-w-40">
              <Text size="small">
                {quarantined
                  ? formatDate(asset.purgeEligibleAt)
                  : "Not scheduled"}
              </Text>
              {quarantined ? (
                <Text className="text-ui-fg-subtle" size="xsmall">
                  Review date only
                </Text>
              ) : null}
            </div>
          )
        },
        header: "Purge review",
        id: "purge-review",
        minSize: 170,
        size: 180,
        truncateTooltip: false,
      }),
    ]

    if (!canManage) {
      return columns
    }

    return [
      ...columns,
      mediaColumnHelper.accessor(() => null, {
        align: "right",
        cell: ({ row }) => {
          const asset = row.original
          return (
            <MediaActionButton
              asset={asset}
              busy={busyAssetId === asset.id}
              disabled={busyAssetId !== null}
              onAction={onAction}
            />
          )
        },
        header: () => <span className="sr-only">Actions</span>,
        id: "actions",
        minSize: 140,
        size: 140,
        truncateTooltip: false,
      }),
    ]
  }, [busyAssetId, canManage, onAction])

type MediaMobileCardProps = MediaActionProps & {
  canManage: boolean
}

const MediaMobileCard = memo<MediaMobileCardProps>(
  ({ asset, busy, canManage, disabled, onAction }) => {
    const quarantined = asset.lifecycleStatus === "quarantined"

    return (
      <li className="border-t border-ui-border-base px-4 py-5 first:border-t-0">
        <div className="flex min-w-0 items-center gap-3">
          <AssetPreview asset={asset} />
          <div className="min-w-0">
            <Text className="truncate" size="small" weight="plus">
              {asset.originalFilename ?? asset.id}
            </Text>
            <Text
              className="truncate text-ui-fg-subtle"
              size="xsmall"
              title={asset.sourceUrl}
            >
              {asset.sourceUrl}
            </Text>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <dt>
              <Text className="text-ui-fg-subtle" size="xsmall">
                Storage
              </Text>
            </dt>
            <dd className="mt-1">
              <StatusBadge color={asset.sourceFileKey ? "green" : "grey"}>
                {asset.sourceFileKey ? "Managed" : "External"}
              </StatusBadge>
              <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                {asset.mimeType ?? "Unknown type"} ·{" "}
                {formatBytes(asset.byteSize)}
              </Text>
            </dd>
          </div>
          <div>
            <dt>
              <Text className="text-ui-fg-subtle" size="xsmall">
                Status
              </Text>
            </dt>
            <dd className="mt-1">
              <StatusBadge color={quarantined ? "orange" : "blue"}>
                {quarantined ? "Quarantined" : "Needs review"}
              </StatusBadge>
              <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                {quarantined
                  ? `Since ${formatDate(asset.quarantinedAt)}`
                  : `Created ${formatDate(asset.createdAt)}`}
              </Text>
              {quarantined ? (
                <Text
                  className="mt-1 truncate text-ui-fg-subtle"
                  size="xsmall"
                  title={asset.quarantinedBy ?? undefined}
                >
                  By {asset.quarantinedBy ?? "unknown operator"}
                </Text>
              ) : null}
            </dd>
          </div>
          <div className="col-span-2">
            <dt>
              <Text className="text-ui-fg-subtle" size="xsmall">
                Purge review
              </Text>
            </dt>
            <dd className="mt-1">
              <Text size="small">
                {quarantined
                  ? formatDate(asset.purgeEligibleAt)
                  : "Not scheduled"}
              </Text>
              {quarantined ? (
                <Text className="text-ui-fg-subtle" size="xsmall">
                  Review date only
                </Text>
              ) : null}
            </dd>
          </div>
        </dl>

        {canManage ? (
          <div className="mt-5 [&>button]:w-full">
            <MediaActionButton
              asset={asset}
              busy={busy}
              disabled={disabled}
              onAction={onAction}
            />
          </div>
        ) : null}
      </li>
    )
  },
)

MediaMobileCard.displayName = "MediaMobileCard"

const MobileLoadingCards = memo(() => (
  <ul aria-label="Loading unlinked catalog media">
    {Array.from({ length: 4 }, (_, index) => (
      <li
        className="border-t border-ui-border-base px-4 py-5 first:border-t-0"
        key={index}
      >
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 shrink-0" />
          <div className="flex-1">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="mt-2 h-4 w-full" />
          </div>
        </div>
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

const MediaEmptyState = memo<{ view: LifecycleStatus }>(({ view }) => (
  <AdminEmptyState
    description={
      view === "active"
        ? "Every active catalog asset is currently attached to a product."
        : "Assets moved to quarantine will remain recoverable here."
    }
    title={
      view === "active"
        ? "No unlinked media needs review"
        : "Quarantine is empty"
    }
  />
))

MediaEmptyState.displayName = "MediaEmptyState"

export const MediaCleanupPageContent = memo(() => {
  const [view, setView] = useState<LifecycleStatus>("active")
  const [pageIndex, setPageIndex] = useState(0)
  const queryClient = useQueryClient()
  const permissions = useAdminPermissions()
  const canUpdate = permissions.hasPermission(
    operationsAdminActions.mediaCleanup.update,
  )

  const offset = pageIndex * PAGE_SIZE
  const orphanQuery = useQuery({
    queryFn: ({ signal }) =>
      requestAdminJson({
        path: "/admin/catalog/media/orphans",
        query: {
          lifecycleStatus: view,
          limit: PAGE_SIZE,
          offset,
        },
        schema: orphanPageSchema,
        signal,
      }),
    queryKey: [...ORPHAN_MEDIA_QUERY_KEY, view, PAGE_SIZE, offset],
    retry: false,
    staleTime: 10_000,
  })
  const page = orphanQuery.data ?? emptyPage(offset)
  const loading = orphanQuery.isPending
  const error = orphanQuery.error
    ? getAdminRequestErrorMessage(
        orphanQuery.error,
        "Unable to load unlinked media.",
      )
    : null
  const countLabel = useMemo(
    () => `${page.count} ${page.count === 1 ? "asset" : "assets"}`,
    [page.count],
  )

  const lifecycleMutation = useMutation({
    mutationFn: async (asset: MediaAsset) => {
      const action =
        asset.lifecycleStatus === "quarantined" ? "restore" : "quarantine"
      await requestAdminJson({
        body: {
          expectedVersion: asset.version,
          idempotencyKey: crypto.randomUUID(),
        },
        method: "POST",
        path: `/admin/catalog/media/assets/${encodeURIComponent(asset.id)}/${action}`,
        schema: lifecycleResponseSchema,
      })
      return action
    },
    onError: (mutationError) => {
      toast.error(
        getAdminRequestErrorMessage(
          mutationError,
          "Unable to update the media lifecycle.",
        ),
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ORPHAN_MEDIA_QUERY_KEY,
      })
    },
    onSuccess: (action) => {
      toast.success(
        action === "restore"
          ? "Media restored"
          : "Media moved to quarantine",
      )
      if (page.assets.length === 1 && pageIndex > 0) {
        setPageIndex((current) => current - 1)
      }
    },
  })
  const busyAssetId = lifecycleMutation.isPending
    ? (lifecycleMutation.variables?.id ?? null)
    : null

  const handleViewChange = useCallback((value: string) => {
    if (!isLifecycleStatus(value)) {
      return
    }
    setView(value)
    setPageIndex(0)
  }, [])

  const handleRetry = useCallback(() => {
    void orphanQuery.refetch()
  }, [orphanQuery])

  const handleLifecycleAction = useCallback(
    (asset: MediaAsset): void => {
      if (!canUpdate || lifecycleMutation.isPending) {
        return
      }
      lifecycleMutation.mutate(asset)
    },
    [canUpdate, lifecycleMutation],
  )
  const columns = useMediaColumns({
    busyAssetId,
    canManage: canUpdate,
    onAction: handleLifecycleAction,
  })
  const pagination = useMemo<DataTablePaginationState>(
    () => ({
      pageIndex,
      pageSize: PAGE_SIZE,
    }),
    [pageIndex],
  )
  const handlePaginationChange = useCallback(
    (state: DataTablePaginationState) => {
      setPageIndex(state.pageIndex)
    },
    [],
  )
  const dataTable = useDataTable({
    columns,
    data: page.assets,
    getRowId: (asset) => asset.id,
    isLoading: loading,
    pagination: {
      onPaginationChange: handlePaginationChange,
      state: pagination,
    },
    rowCount: page.count,
  })
  const desktopEmptyState = useMemo<DataTableEmptyStateProps>(
    () => ({
      empty: {
        custom: <MediaEmptyState view={view} />,
      },
    }),
    [view],
  )
  const mobileCollection = useMemo<ReactNode>(() => {
    if (loading) {
      return <MobileLoadingCards />
    }
    if (page.assets.length === 0) {
      return <MediaEmptyState view={view} />
    }
    return (
      <ul aria-label="Unlinked catalog media available for lifecycle review">
        {page.assets.map((asset) => (
          <MediaMobileCard
            asset={asset}
            busy={busyAssetId === asset.id}
            canManage={canUpdate}
            disabled={busyAssetId !== null}
            key={asset.id}
            onAction={handleLifecycleAction}
          />
        ))}
      </ul>
    )
  }, [
    busyAssetId,
    canUpdate,
    handleLifecycleAction,
    loading,
    page.assets,
    view,
  ])

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          actions={
            <Text
              aria-live="polite"
              className="text-ui-fg-subtle"
              size="small"
            >
              {loading ? "Loading assets…" : countLabel}
            </Text>
          }
          description={
            <>
              Review images that are not attached to any product. Quarantine
              keeps the file recoverable while preventing accidental reuse.
            </>
          }
          title="Media cleanup"
        />
        <OperationsWorkspaceNavigation
          active="media-cleanup"
          className="mt-5"
        />

        <Alert className="mt-5" variant="warning">
          <Text weight="plus">Physical deletion is disabled</Text>
          <Text size="small">
            Quarantine is reversible. The 30-day date is only the earliest
            review point for a future operator-approved purge; nothing is
            deleted automatically.
          </Text>
        </Alert>

        {!canUpdate ? (
          <Alert className="mt-4" variant="info">
            <Text weight="plus">View-only access</Text>
            <Text size="small">
              A role with Media cleanup update permission is required to move
              assets into or out of quarantine.
            </Text>
          </Alert>
        ) : null}
      </Container>

      {error ? (
        <AdminRetryState
          message={error}
          onRetry={handleRetry}
          retrying={orphanQuery.isFetching}
          title="Media cleanup could not load"
        />
      ) : (
        <Container className="p-0">
          <div className="px-6 pt-5">
            <Tabs value={view} onValueChange={handleViewChange}>
              <Tabs.List>
                <Tabs.Trigger value="active">Needs review</Tabs.Trigger>
                <Tabs.Trigger value="quarantined">Quarantined</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>

          <AdminResponsiveDataTable
            desktopEmptyState={desktopEmptyState}
            instance={dataTable}
            mobile={mobileCollection}
            showPagination={loading || page.count > 0}
          />
        </Container>
      )}
    </AdminSingleColumnLayout>
  )
})

MediaCleanupPageContent.displayName = "MediaCleanupPageContent"

export const MediaCleanupPage = memo(() => (
  <AdminPermissionBoundary
    actions={operationsAdminActions.mediaCleanup.read}
    workspace="Media cleanup"
  >
    <MediaCleanupPageContent />
  </AdminPermissionBoundary>
))

MediaCleanupPage.displayName = "MediaCleanupPage"

const LegacyMediaCleanupPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis as unknown as {
      location: ReplaceAdminLocation
    }
    replaceLegacyOperationsLocation(location, "media-cleanup")
  }, [])

  return null
})

LegacyMediaCleanupPage.displayName = "LegacyMediaCleanupPage"

export default LegacyMediaCleanupPage
