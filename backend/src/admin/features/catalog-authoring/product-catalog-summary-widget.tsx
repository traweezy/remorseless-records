"use client"

import { memo, useCallback, useMemo } from "react"
import type { AdminProduct } from "@medusajs/framework/types"
import {
  Badge,
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
import { catalogProductSummaryReadActions } from "../catalog-permissions"
import { productAuthoringViewQueryOptions } from "./product-authoring-query"
import {
  buildProductCatalogSummary,
  type ProductCatalogAvailability,
  type ProductCatalogBundleHealth,
  type ProductCatalogCompletion,
} from "./product-summary-state"

type ProductCatalogSummaryWidgetProps = {
  data: AdminProduct
}

const CompletionStatus = memo<{
  completion: ProductCatalogCompletion
}>(({ completion }) => (
  <StatusBadge color={completion.color}>{completion.label}</StatusBadge>
))

CompletionStatus.displayName = "CompletionStatus"

const AvailabilityStatus = memo<{
  availability: ProductCatalogAvailability
}>(({ availability }) => (
  <StatusBadge color={availability.color}>{availability.label}</StatusBadge>
))

AvailabilityStatus.displayName = "AvailabilityStatus"

const BundleStatus = memo<{
  bundleHealth: ProductCatalogBundleHealth
}>(({ bundleHealth }) => (
  <StatusBadge color={bundleHealth.color}>{bundleHealth.label}</StatusBadge>
))

BundleStatus.displayName = "BundleStatus"

const ProductCatalogSummarySkeleton = memo(() => (
  <Container aria-busy="true" aria-label="Loading catalog summary">
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-8 w-36" />
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-24" key={index} />
      ))}
    </div>
  </Container>
))

ProductCatalogSummarySkeleton.displayName = "ProductCatalogSummarySkeleton"

const ProductCatalogSummaryWidgetContent =
  memo<ProductCatalogSummaryWidgetProps>(({ data }) => {
    const productId = data.id
    const query = useQuery(productAuthoringViewQueryOptions(productId))
    const summary = useMemo(
      () => (query.data ? buildProductCatalogSummary(query.data) : null),
      [query.data]
    )
    const handleRetry = useCallback(() => {
      void query.refetch()
    }, [query])

    if (query.isPending) {
      return <ProductCatalogSummarySkeleton />
    }
    if (query.isError || !query.data || !summary) {
      return (
        <AdminRetryState
          message={getAdminRequestErrorMessage(
            query.error,
            "The consolidated catalog record could not be loaded."
          )}
          onRetry={handleRetry}
          retrying={query.isFetching}
          title="Catalog summary unavailable"
        />
      )
    }

    return (
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level="h2">Catalog summary</Heading>
              <Badge color="grey" size="2xsmall">
                {summary.kindLabel}
              </Badge>
            </div>
            <Text className="mt-1 text-ui-fg-subtle" size="small">
              {summary.artistLabel} · {summary.releaseLabel}
            </Text>
          </div>
          <Button asChild size="small" variant="secondary">
            <Link to={`/catalog/products/${encodeURIComponent(productId)}`}>
              Edit catalog details
            </Link>
          </Button>
        </div>

        <div className="grid gap-3 px-6 py-5 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard
            description={summary.completion.description}
            label="Catalog completion"
          >
            <CompletionStatus completion={summary.completion} />
          </AdminStatCard>
          <AdminStatCard
            description={summary.availability.description}
            label="Customer availability"
          >
            <AvailabilityStatus availability={summary.availability} />
          </AdminStatCard>
          <AdminStatCard
            description={summary.media.description}
            label="Managed media"
          >
            <Text weight="plus">
              {summary.media.total}{" "}
              {summary.media.total === 1 ? "image" : "images"}
            </Text>
          </AdminStatCard>
          {summary.bundleHealth ? (
            <AdminStatCard
              description={summary.bundleHealth.description}
              label="Bundle mapping"
            >
              <BundleStatus bundleHealth={summary.bundleHealth} />
            </AdminStatCard>
          ) : (
            <AdminStatCard
              description="Offerings are managed as native Medusa variants."
              label="Offerings"
            >
              <Text weight="plus">
                {query.data.commerce.variants.length}{" "}
                {query.data.commerce.variants.length === 1
                  ? "variant"
                  : "variants"}
              </Text>
            </AdminStatCard>
          )}
        </div>
      </Container>
    )
  })

ProductCatalogSummaryWidgetContent.displayName =
  "ProductCatalogSummaryWidgetContent"

export const ProductCatalogSummaryWidget =
  memo<ProductCatalogSummaryWidgetProps>(({ data }) => (
    <AdminPermissionBoundary
      actions={catalogProductSummaryReadActions}
      surface="widget"
      workspace="Catalog product summary"
    >
      <ProductCatalogSummaryWidgetContent data={data} />
    </AdminPermissionBoundary>
  ))

ProductCatalogSummaryWidget.displayName = "ProductCatalogSummaryWidget"
