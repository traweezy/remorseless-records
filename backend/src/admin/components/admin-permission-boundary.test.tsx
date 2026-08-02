import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import {
  adminPermissionKey,
  contentAdminActions,
} from "../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
  type AdminFeatureFlags,
  type AdminPermissionsResponse,
} from "../lib/admin-permissions"
import { AdminPermissionBoundary } from "./admin-permission-boundary"

const renderBoundary = ({
  flags,
  permissions,
}: {
  flags: AdminFeatureFlags
  permissions?: AdminPermissionsResponse
}): string => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(adminFeatureFlagsQueryKey, flags)
  if (permissions) {
    queryClient.setQueryData(adminPermissionsQueryKey, permissions)
  }

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPermissionBoundary
        actions={contentAdminActions.news.read}
        workspace="News"
      >
        <div>Protected news content</div>
      </AdminPermissionBoundary>
    </QueryClientProvider>,
  )
  queryClient.clear()
  return markup
}

describe("AdminPermissionBoundary", () => {
  it("preserves existing access while RBAC is disabled", () => {
    const markup = renderBoundary({ flags: { rbac: false } })

    expect(markup).toContain("Protected news content")
    expect(markup).not.toContain("Access restricted")
  })

  it("renders protected content when the role has access", () => {
    const markup = renderBoundary({
      flags: { rbac: true },
      permissions: {
        permissions: [adminPermissionKey(contentAdminActions.news.read)],
      },
    })

    expect(markup).toContain("Protected news content")
    expect(markup).not.toContain("Access restricted")
  })

  it("does not mount protected content when the role lacks access", () => {
    const markup = renderBoundary({
      flags: { rbac: true },
      permissions: { permissions: [] },
    })

    expect(markup).toContain("Access restricted")
    expect(markup).toContain("No protected content was loaded")
    expect(markup).not.toContain("Protected news content")
  })
})
