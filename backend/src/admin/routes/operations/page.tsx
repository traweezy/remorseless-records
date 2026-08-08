"use client"

import { memo } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowRightMini,
  ArrowUturnLeft,
  Photo,
  ReceiptPercent,
  Wrench,
} from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { operationsAdminActions } from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { OperationsWorkspaceNavigation } from "../../features/operations/operations-navigation"
import { operationsRoutePaths } from "../../features/operations/operations-routes"
import { useAdminPermissions } from "../../lib/admin-permissions"

type OperationsWorkspaceCardProps = {
  description: string
  detail: string
  icon: typeof ReceiptPercent
  label: string
  linkLabel: string
  to: string
}

const OperationsWorkspaceCard = memo<OperationsWorkspaceCardProps>(
  ({ description, detail, icon: Icon, label, linkLabel, to }) => (
    <Container className="flex h-full flex-col">
      <div
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-md border border-ui-border-base bg-ui-bg-subtle"
      >
        <Icon className="text-ui-fg-subtle" />
      </div>
      <Heading className="mt-4" level="h2">
        {label}
      </Heading>
      <Text className="mt-2 text-ui-fg-subtle" size="small">
        {description}
      </Text>
      <Text className="mt-4 text-ui-fg-muted" size="xsmall">
        {detail}
      </Text>
      <div className="mt-6">
        <Button asChild size="small" variant="secondary">
          <Link to={to}>
            {linkLabel}
            <ArrowRightMini aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Container>
  ),
)

OperationsWorkspaceCard.displayName = "OperationsWorkspaceCard"

const OperationsPageContent = memo(() => {
  const permissions = useAdminPermissions()
  const canReadTaxRecords = permissions.hasPermission(
    operationsAdminActions.taxRecords.read,
  )
  const canReadRefunds = permissions.hasPermission(
    operationsAdminActions.refundOperations.read,
  )
  const canReadMediaCleanup = permissions.hasPermission(
    operationsAdminActions.mediaCleanup.read,
  )
  const workspaceCount =
    Number(canReadTaxRecords) +
    Number(canReadRefunds) +
    Number(canReadMediaCleanup)

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          description="Review financial records, resolve refund exceptions, and keep managed catalog media orderly."
          status={
            <Text className="text-ui-fg-subtle" size="small">
              {workspaceCount} {workspaceCount === 1 ? "workspace" : "workspaces"}
            </Text>
          }
          title="Operations"
        />
        <OperationsWorkspaceNavigation
          active="overview"
          className="mt-5"
          showMediaCleanup={canReadMediaCleanup}
          showRefunds={canReadRefunds}
          showTaxRecords={canReadTaxRecords}
        />
      </Container>

      <section
        aria-label="Choose an operations workspace"
        className="grid gap-3 lg:grid-cols-3"
      >
        {canReadTaxRecords ? (
          <OperationsWorkspaceCard
            description="Build state-specific filing workpapers and export privacy-minimized transaction evidence."
            detail="CT · NY · PA · CSV workpapers"
            icon={ReceiptPercent}
            label="Tax records"
            linkLabel="Open tax records"
            to={operationsRoutePaths["tax-records"]}
          />
        ) : null}
        {canReadRefunds ? (
          <OperationsWorkspaceCard
            description="Monitor Medusa, Stripe, and tax evidence until every known refund reaches a clear outcome."
            detail="Exceptions · Reconciliation · Customer resolution"
            icon={ArrowUturnLeft}
            label="Refunds"
            linkLabel="Open refunds"
            to={operationsRoutePaths.refunds}
          />
        ) : null}
        {canReadMediaCleanup ? (
          <OperationsWorkspaceCard
            description="Review unlinked catalog assets and manage the reversible quarantine lifecycle."
            detail="Unlinked · Quarantined · Recoverable"
            icon={Photo}
            label="Media cleanup"
            linkLabel="Open media cleanup"
            to={operationsRoutePaths["media-cleanup"]}
          />
        ) : null}
      </section>
    </AdminSingleColumnLayout>
  )
})

OperationsPageContent.displayName = "OperationsPageContent"

export const OperationsPage = memo(() => (
  <AdminPermissionBoundary
    actions={[
      operationsAdminActions.taxRecords.read,
      operationsAdminActions.refundOperations.read,
      operationsAdminActions.mediaCleanup.read,
    ]}
    match="some"
    workspace="Operations"
  >
    <OperationsPageContent />
  </AdminPermissionBoundary>
))

OperationsPage.displayName = "OperationsPage"

export const config = defineRouteConfig({
  icon: Wrench,
  label: "Operations",
  rank: 2,
})

export const handle = {
  breadcrumb: () => "Operations",
}

export default OperationsPage
