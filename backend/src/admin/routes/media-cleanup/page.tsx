"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  Heading,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Text,
  toast,
} from "@medusajs/ui"
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { z } from "zod"

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

const MediaRow = memo<MediaActionProps>(({ asset, busy, disabled, onAction }) => {
  const quarantined = asset.lifecycleStatus === "quarantined"

  return (
    <Table.Row>
      <Table.Cell>
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
      </Table.Cell>
      <Table.Cell>
        <div className="flex min-w-32 flex-col gap-1">
          <StatusBadge color={asset.sourceFileKey ? "green" : "grey"}>
            {asset.sourceFileKey ? "Managed" : "External"}
          </StatusBadge>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {asset.mimeType ?? "Unknown type"} · {formatBytes(asset.byteSize)}
          </Text>
        </div>
      </Table.Cell>
      <Table.Cell>
        <div className="flex min-w-36 flex-col gap-1">
          <StatusBadge color={quarantined ? "orange" : "blue"}>
            {quarantined ? "Quarantined" : "Needs review"}
          </StatusBadge>
          <Text size="xsmall" className="text-ui-fg-subtle">
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
      </Table.Cell>
      <Table.Cell>
        <div className="min-w-40">
          <Text size="small">
            {quarantined
              ? formatDate(asset.purgeEligibleAt)
              : "Not scheduled"}
          </Text>
          {quarantined ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Review date only
            </Text>
          ) : null}
        </div>
      </Table.Cell>
      <Table.Cell>
        <div className="flex justify-end">
          <MediaActionButton
            asset={asset}
            busy={busy}
            disabled={disabled}
            onAction={onAction}
          />
        </div>
      </Table.Cell>
    </Table.Row>
  )
})

MediaRow.displayName = "MediaRow"

const MediaMobileCard = memo<MediaActionProps>(
  ({ asset, busy, disabled, onAction }) => {
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

        <div className="mt-5 [&>button]:w-full">
          <MediaActionButton
            asset={asset}
            busy={busy}
            disabled={disabled}
            onAction={onAction}
          />
        </div>
      </li>
    )
  },
)

MediaMobileCard.displayName = "MediaMobileCard"

const LoadingRows = memo(() => (
  <>
    {Array.from({ length: 5 }, (_, index) => (
      <Table.Row key={index}>
        <Table.Cell>
          <Skeleton className="h-12 w-64" />
        </Table.Cell>
        <Table.Cell>
          <Skeleton className="h-8 w-32" />
        </Table.Cell>
        <Table.Cell>
          <Skeleton className="h-8 w-32" />
        </Table.Cell>
        <Table.Cell>
          <Skeleton className="h-8 w-40" />
        </Table.Cell>
        <Table.Cell>
          <Skeleton className="ml-auto h-8 w-24" />
        </Table.Cell>
      </Table.Row>
    ))}
  </>
))

LoadingRows.displayName = "LoadingRows"

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

const MediaCleanupPage = memo(() => {
  const [view, setView] = useState<LifecycleStatus>("active")
  const [pageIndex, setPageIndex] = useState(0)
  const queryClient = useQueryClient()

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
  const pageCount = useMemo(
    () => Math.ceil(page.count / PAGE_SIZE),
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

  const handlePrevious = useCallback(() => {
    setPageIndex((current) => Math.max(0, current - 1))
  }, [])

  const handleNext = useCallback(() => {
    setPageIndex((current) => current + 1)
  }, [])

  const handleRetry = useCallback(() => {
    void orphanQuery.refetch()
  }, [orphanQuery])

  const handleLifecycleAction = useCallback(
    (asset: MediaAsset): void => {
      if (lifecycleMutation.isPending) {
        return
      }
      lifecycleMutation.mutate(asset)
    },
    [lifecycleMutation],
  )

  return (
    <div className="flex flex-col gap-3">
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <Heading level="h1">Media cleanup</Heading>
            <Text className="mt-1 text-ui-fg-subtle">
              Review images that are not attached to any product. Quarantine
              keeps the file recoverable while preventing accidental reuse.
            </Text>
          </div>
          <Text aria-live="polite" className="text-ui-fg-subtle" size="small">
            {loading ? "Loading assets…" : countLabel}
          </Text>
        </div>

        <Alert className="mt-5" variant="warning">
          <Text weight="plus">Physical deletion is disabled</Text>
          <Text size="small">
            Quarantine is reversible. The 30-day date is only the earliest
            review point for a future operator-approved purge; nothing is
            deleted automatically.
          </Text>
        </Alert>
      </Container>

      <Container className="p-0">
        <div className="px-6 pt-5">
          <Tabs value={view} onValueChange={handleViewChange}>
            <Tabs.List>
              <Tabs.Trigger value="active">Needs review</Tabs.Trigger>
              <Tabs.Trigger value="quarantined">Quarantined</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </div>

        {error ? (
          <div className="px-6 py-5">
            <Alert variant="error">
              <Text weight="plus">Media cleanup could not load</Text>
              <Text size="small">{error}</Text>
              <Button
                className="mt-3"
                onClick={handleRetry}
                size="small"
                variant="secondary"
              >
                Retry
              </Button>
            </Alert>
          </div>
        ) : !loading && page.assets.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
            <Heading level="h2">
              {view === "active"
                ? "No unlinked media needs review"
                : "Quarantine is empty"}
            </Heading>
            <Text
              className="mt-1 max-w-lg text-ui-fg-subtle"
              size="small"
            >
              {view === "active"
                ? "Every active catalog asset is currently attached to a product."
                : "Assets moved to quarantine will remain recoverable here."}
            </Text>
          </div>
        ) : (
          <>
            <div className="mt-4 md:hidden">
              {loading ? <MobileLoadingCards /> : null}
              {!loading ? (
                <ul aria-label="Unlinked catalog media available for lifecycle review">
                  {page.assets.map((asset) => (
                    <MediaMobileCard
                      asset={asset}
                      busy={busyAssetId === asset.id}
                      disabled={busyAssetId !== null}
                      key={asset.id}
                      onAction={handleLifecycleAction}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <Table>
                <caption className="sr-only">
                  Unlinked catalog media available for lifecycle review
                </caption>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell scope="col">Asset</Table.HeaderCell>
                    <Table.HeaderCell scope="col">Storage</Table.HeaderCell>
                    <Table.HeaderCell scope="col">Status</Table.HeaderCell>
                    <Table.HeaderCell scope="col">
                      Purge review
                    </Table.HeaderCell>
                    <Table.HeaderCell scope="col">
                      <span className="sr-only">Actions</span>
                    </Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {loading ? <LoadingRows /> : null}
                  {!loading
                    ? page.assets.map((asset) => (
                        <MediaRow
                          asset={asset}
                          busy={busyAssetId === asset.id}
                          disabled={busyAssetId !== null}
                          key={asset.id}
                          onAction={handleLifecycleAction}
                        />
                      ))
                    : null}
                </Table.Body>
              </Table>
            </div>
          </>
        )}

        <Table.Pagination
          canNextPage={!loading && page.hasMore}
          canPreviousPage={!loading && pageIndex > 0}
          count={page.count}
          nextPage={handleNext}
          pageCount={pageCount}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          previousPage={handlePrevious}
        />
      </Container>
    </div>
  )
})

MediaCleanupPage.displayName = "MediaCleanupPage"

export const config = defineRouteConfig({
  icon: Photo,
  label: "Media cleanup",
  rank: 91,
})

export const handle = {
  breadcrumb: () => "Media cleanup",
}

export default MediaCleanupPage
