"use client"

import { memo } from "react"
import { Button, clx } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  contentRoutePaths,
  type ContentWorkspace,
} from "./content-routes"

type ContentWorkspaceNavigationProps = {
  active: ContentWorkspace
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

export const ContentWorkspaceNavigation = memo<
  ContentWorkspaceNavigationProps
>(({ active, className }) => (
  <nav
    aria-label="Content workspaces"
    className={clx("flex flex-wrap gap-2", className)}
  >
    <NavigationItem
      active={active === "overview"}
      label="Overview"
      to={contentRoutePaths.overview}
    />
    <NavigationItem
      active={active === "news"}
      label="News"
      to={contentRoutePaths.news}
    />
    <NavigationItem
      active={active === "discography"}
      label="Discography"
      to={contentRoutePaths.discography}
    />
  </nav>
))

ContentWorkspaceNavigation.displayName = "ContentWorkspaceNavigation"
