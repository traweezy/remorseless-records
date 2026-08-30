import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import {
  adminPermissionKey,
  contentAdminActions,
  nativeAdminActions,
} from "../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../lib/admin-permissions"
import { ContentPage, config } from "./page"

const renderContentPage = ({
  rbac = false,
  permissions = [],
}: {
  rbac?: boolean
  permissions?: string[]
} = {}): string => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac })
  if (rbac) {
    queryClient.setQueryData(adminPermissionsQueryKey, { permissions })
  }
  const markup = renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ContentPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
  queryClient.clear()
  return markup
}

describe("Content Admin route", () => {
  it("presents one overview and two clearly separated workspaces", () => {
    const markup = renderContentPage()

    expect(config).toMatchObject({ label: "Content", rank: 1 })
    expect(markup).toContain(">Content</h1>")
    expect(markup).toContain(">News</h2>")
    expect(markup).toContain(">Discography</h2>")
    expect(markup).toContain('href="/content/news"')
    expect(markup).toContain('href="/content/discography"')
    expect(markup).toContain("2 workspaces")
  })

  it("shows only the workspace granted to a restricted role", () => {
    const markup = renderContentPage({
      permissions: [adminPermissionKey(contentAdminActions.news.read)],
      rbac: true,
    })

    expect(markup).toContain(">News</h2>")
    expect(markup).not.toContain(">Discography</h2>")
    expect(markup).toContain("1 workspace")
  })

  it("does not advertise Discography without the complete read capability", () => {
    const markup = renderContentPage({
      permissions: [adminPermissionKey(contentAdminActions.discography.read)],
      rbac: true,
    })

    expect(markup).not.toContain(">Discography</h2>")
    expect(markup).not.toContain('href="/content/discography"')
    expect(markup).toContain("Access restricted")
    expect(markup).toContain("No protected content was loaded")
  })

  it("advertises Discography when both required reads are granted", () => {
    const markup = renderContentPage({
      permissions: [
        adminPermissionKey(contentAdminActions.discography.read),
        adminPermissionKey(nativeAdminActions.product.read),
      ],
      rbac: true,
    })

    expect(markup).not.toContain(">News</h2>")
    expect(markup).toContain(">Discography</h2>")
    expect(markup).toContain('href="/content/discography"')
    expect(markup).toContain("1 workspace")
  })
})
