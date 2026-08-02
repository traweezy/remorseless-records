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
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { ContentWorkspaceNavigation } from "../../features/content/content-navigation"
import { contentRoutePaths } from "../../features/content/content-routes"

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

export const ContentPage = memo(() => (
  <AdminSingleColumnLayout>
    <Container>
      <AdminPageHeader
        description="Manage the label stories and release history customers see outside the product catalog."
        status={
          <Text className="text-ui-fg-subtle" size="small">
            2 workspaces
          </Text>
        }
        title="Content"
      />
      <ContentWorkspaceNavigation active="overview" className="mt-5" />
    </Container>

    <section
      aria-label="Choose a content workspace"
      className="grid gap-3 lg:grid-cols-2"
    >
      <ContentWorkspaceCard
        description="Write label announcements, save private drafts, schedule publication, and retain archived history."
        detail="Draft · Schedule · Publish · Archive"
        icon={Newspaper}
        label="News"
        linkLabel="Open News"
        to={contentRoutePaths.news}
      />
      <ContentWorkspaceCard
        description="Review releases synchronized from Products and maintain historical releases that are no longer sold."
        detail="Catalog-linked · Historical · Recoverable"
        icon={DocumentText}
        label="Discography"
        linkLabel="Open Discography"
        to={contentRoutePaths.discography}
      />
    </section>
  </AdminSingleColumnLayout>
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
