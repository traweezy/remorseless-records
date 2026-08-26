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
  surface,
}: {
  flags?: AdminFeatureFlags
  permissions?: AdminPermissionsResponse
  surface?: "page" | "widget"
}): string => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (flags) {
    queryClient.setQueryData(adminFeatureFlagsQueryKey, flags)
  }
  if (permissions) {
    queryClient.setQueryData(adminPermissionsQueryKey, permissions)
  }

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPermissionBoundary
        actions={contentAdminActions.news.read}
        workspace="News"
        {...(surface ? { surface } : {})}
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

  it("uses a compact pending state for widgets", () => {
    const markup = renderBoundary({ surface: "widget" })

    expect(markup).toContain("Checking widget access")
    expect(markup).not.toContain("Protected news content")
    expect(markup).not.toContain("Access restricted")
  })

  it("hides denied widgets without mounting protected content", () => {
    const markup = renderBoundary({
      flags: { rbac: true },
      permissions: { permissions: [] },
      surface: "widget",
    })

    expect(markup).toBe("")
    expect(markup).not.toContain("Protected news content")
  })

  it("renders protected widget content when the role has access", () => {
    const markup = renderBoundary({
      flags: { rbac: true },
      permissions: {
        permissions: [adminPermissionKey(contentAdminActions.news.read)],
      },
      surface: "widget",
    })

    expect(markup).toContain("Protected news content")
  })

  it("offers a compact retry state when a widget access check fails", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { refetchOnMount: false, retry: false },
      },
    })
    queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: false })
    const featureFlagsQuery = queryClient.getQueryCache().find({
      queryKey: adminFeatureFlagsQueryKey,
    })
    const error = new Error("Permission service unavailable")
    featureFlagsQuery?.setState({
      ...featureFlagsQuery.state,
      error,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
      fetchFailureReason: error,
      fetchStatus: "idle",
      status: "error",
    })

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AdminPermissionBoundary
          actions={contentAdminActions.news.read}
          surface="widget"
          workspace="News"
        >
          <div>Protected news content</div>
        </AdminPermissionBoundary>
      </QueryClientProvider>,
    )
    queryClient.clear()

    expect(markup).toContain("Access check could not complete")
    expect(markup).toContain("Try again")
    expect(markup).toContain("No protected content was loaded")
    expect(markup).not.toContain("Protected news content")
  })
})
