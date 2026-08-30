"use client"

import { memo, useCallback, useMemo } from "react"
import {
  Button,
  Container,
  Heading,
  Skeleton,
  StatusBadge,
  Text,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { AdminRetryState } from "../../components/admin-retry-state"
import { AdminStatCard } from "../../components/admin-stat-card"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import { catalogProductListGuideActions } from "../catalog-permissions"
import { catalogAuthoringAuditQueryOptions } from "./catalog-authoring-audit-query"

const CatalogProductListGuideSkeleton = memo(() => (
  <Container aria-busy="true" aria-label="Loading catalog workspace summary">
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-8 w-40" />
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-20" key={index} />
      ))}
    </div>
  </Container>
))

CatalogProductListGuideSkeleton.displayName = "CatalogProductListGuideSkeleton"

const CatalogProductListGuideWidgetContent = memo(() => {
  const query = useQuery(catalogAuthoringAuditQueryOptions())
  const handleRetry = useCallback(() => {
    void query.refetch()
  }, [query])
  const nonReleaseCount = useMemo(() => {
    if (!query.data) {
      return 0
    }
    const { byKind } = query.data.summary
    return byKind.merch + byKind.fixed_bundle + byKind.mystery_bundle
  }, [query.data])

  if (query.isPending) {
    return <CatalogProductListGuideSkeleton />
  }
  if (query.isError || !query.data) {
    return (
      <AdminRetryState
        message={getAdminRequestErrorMessage(
          query.error,
          "Catalog readiness could not be loaded."
        )}
        onRetry={handleRetry}
        retrying={query.isFetching}
        title="Catalog workspace unavailable"
      />
    )
  }

  const { summary } = query.data
  const hasBlockingItems = summary.blockingItemCount > 0

  return (
    <Container className="divide-y p-0" id="catalog-product-list-guide">
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level="h2">Catalog workspace</Heading>
            <StatusBadge color={hasBlockingItems ? "orange" : "green"}>
              {hasBlockingItems
                ? `${summary.blockingItemCount} need review`
                : "Catalog consistent"}
            </StatusBadge>
          </div>
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            Create products through the guided catalog workflow so Storefront
            formats, fulfillment SKUs, prices, media, and release details stay
            aligned from the first draft.
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="small" variant="secondary">
            <Link to="/catalog-authoring">Review catalog</Link>
          </Button>
          <Button asChild size="small">
            <Link to="/products/create">Create catalog product</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          description="Active Medusa products covered by the catalog model."
          label="Catalog products"
        >
          <Text weight="plus">{summary.total}</Text>
        </AdminStatCard>
        <AdminStatCard
          description="Products whose catalog kind is unambiguous."
          label="Classified"
        >
          <Text weight="plus">{summary.byStatus.classified}</Text>
        </AdminStatCard>
        <AdminStatCard
          description="Music products using release-oriented authoring."
          label="Music releases"
        >
          <Text weight="plus">{summary.byKind.music_release}</Text>
        </AdminStatCard>
        <AdminStatCard
          description="Merchandise, fixed bundles, and mystery bundles."
          label="Merch and bundles"
        >
          <Text weight="plus">{nonReleaseCount}</Text>
        </AdminStatCard>
      </div>
    </Container>
  )
})

CatalogProductListGuideWidgetContent.displayName =
  "CatalogProductListGuideWidgetContent"

export const CatalogProductListGuideWidget = memo(() => (
  <AdminPermissionBoundary
    actions={catalogProductListGuideActions}
    surface="widget"
    workspace="Catalog product list guide"
  >
    <CatalogProductListGuideWidgetContent />
  </AdminPermissionBoundary>
))

CatalogProductListGuideWidget.displayName = "CatalogProductListGuideWidget"
