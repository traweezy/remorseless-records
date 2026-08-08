"use client"

import { memo } from "react"
import { Button, clx } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  operationsRoutePaths,
  type OperationsWorkspace,
} from "./operations-routes"

type OperationsWorkspaceNavigationProps = {
  active: OperationsWorkspace
  className?: string
  showMediaCleanup?: boolean
  showRefunds?: boolean
  showTaxRecords?: boolean
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

export const OperationsWorkspaceNavigation = memo<
  OperationsWorkspaceNavigationProps
>(
  ({
    active,
    className,
    showMediaCleanup = true,
    showRefunds = true,
    showTaxRecords = true,
  }) => (
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
  ),
)

OperationsWorkspaceNavigation.displayName = "OperationsWorkspaceNavigation"
