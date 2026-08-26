"use client"

import { memo } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowRightMini,
  BookOpen,
  DocumentText,
  Newspaper,
} from "@medusajs/icons"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  contentAdminActions,
} from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { ContentWorkspaceNavigation } from "../../features/content/content-navigation"
import {
  discographyReadActions,
  hasDiscographyReadAccess,
} from "../../features/content/content-permissions"
import { contentRoutePaths } from "../../features/content/content-routes"
import { useAdminPermissions } from "../../lib/admin-permissions"

type ContentWorkspaceCardProps = {
  description: string
  detail: string
  icon: typeof Newspaper
  label: string
  linkLabel: string
  to: string
}

const ContentWorkspaceCard = memo<ContentWorkspaceCardProps>(
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

ContentWorkspaceCard.displayName = "ContentWorkspaceCard"

const ContentPageContent = memo(() => {
  const permissions = useAdminPermissions()
  const canReadNews = permissions.hasPermission(contentAdminActions.news.read)
  const canReadDiscography = hasDiscographyReadAccess(
    permissions.hasPermission,
  )
  const workspaceCount = Number(canReadNews) + Number(canReadDiscography)

  if (workspaceCount === 0) {
    return (
      <AdminPermissionBoundary
        actions={discographyReadActions}
        workspace="Content"
      >
        {null}
      </AdminPermissionBoundary>
    )
  }

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          description="Manage the label stories and release history customers see outside the product catalog."
          status={
            <Text className="text-ui-fg-subtle" size="small">
              {workspaceCount} {workspaceCount === 1 ? "workspace" : "workspaces"}
            </Text>
          }
          title="Content"
        />
        <ContentWorkspaceNavigation
          active="overview"
          className="mt-5"
          showDiscography={canReadDiscography}
          showNews={canReadNews}
        />
      </Container>

      <section
        aria-label="Choose a content workspace"
        className="grid gap-3 lg:grid-cols-2"
      >
        {canReadNews ? (
          <ContentWorkspaceCard
            description="Write label announcements, save private drafts, schedule publication, and retain archived history."
            detail="Draft · Schedule · Publish · Archive"
            icon={Newspaper}
            label="News"
            linkLabel="Open News"
            to={contentRoutePaths.news}
          />
        ) : null}
        {canReadDiscography ? (
          <ContentWorkspaceCard
            description="Review releases synchronized from Products and maintain historical releases that are no longer sold."
            detail="Catalog-linked · Historical · Recoverable"
            icon={DocumentText}
            label="Discography"
            linkLabel="Open Discography"
            to={contentRoutePaths.discography}
          />
        ) : null}
      </section>
    </AdminSingleColumnLayout>
  )
})

ContentPageContent.displayName = "ContentPageContent"

export const ContentPage = memo(() => (
  <AdminPermissionBoundary
    actions={[
      contentAdminActions.news.read,
      contentAdminActions.discography.read,
    ]}
    match="some"
    workspace="Content"
  >
    <ContentPageContent />
  </AdminPermissionBoundary>
))

ContentPage.displayName = "ContentPage"

export const config = defineRouteConfig({
  icon: BookOpen,
  label: "Content",
  rank: 1,
})

export const handle = {
  breadcrumb: () => "Content",
}

export default ContentPage
