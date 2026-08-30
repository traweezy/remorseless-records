"use client"

import { memo } from "react"
import { Button, clx } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { operationsAdminActions } from "../../../lib/admin-permissions"
import { useAdminPermissions } from "../../lib/admin-permissions"
import {
  operationsRoutePaths,
  type OperationsWorkspace,
} from "./operations-routes"

type OperationsWorkspaceNavigationProps = {
  active: OperationsWorkspace
  className?: string
}

type NavigationItemProps = {
  active: boolean
  label: string
  to: string
}

const NavigationItem = memo<NavigationItemProps>(({ active, label, to }) => (
  <Button asChild size="small" variant={active ? "primary" : "secondary"}>
    <Link aria-current={active ? "page" : undefined} to={to}>
      {label}
    </Link>
  </Button>
))

NavigationItem.displayName = "NavigationItem"

export const OperationsWorkspaceNavigation =
  memo<OperationsWorkspaceNavigationProps>(({ active, className }) => {
    const permissions = useAdminPermissions()
    const showTaxRecords = permissions.hasPermission(
      operationsAdminActions.taxRecords.read
    )
    const showRefunds = permissions.hasPermission(
      operationsAdminActions.refundOperations.read
    )
    const showMediaCleanup = permissions.hasPermission(
      operationsAdminActions.mediaCleanup.read
    )

    return (
      <nav
        aria-label="Operations workspaces"
        className={clx("flex flex-wrap gap-2", className)}
      >
        <NavigationItem
          active={active === "overview"}
          label="Overview"
          to={operationsRoutePaths.overview}
        />
        {showTaxRecords ? (
          <NavigationItem
            active={active === "tax-records"}
            label="Tax records"
            to={operationsRoutePaths["tax-records"]}
          />
        ) : null}
        {showRefunds ? (
          <NavigationItem
            active={active === "refunds"}
            label="Refunds"
            to={operationsRoutePaths.refunds}
          />
        ) : null}
        {showMediaCleanup ? (
          <NavigationItem
            active={active === "media-cleanup"}
            label="Media cleanup"
            to={operationsRoutePaths["media-cleanup"]}
          />
        ) : null}
      </nav>
    )
  })

OperationsWorkspaceNavigation.displayName = "OperationsWorkspaceNavigation"
