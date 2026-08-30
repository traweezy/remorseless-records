import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import {
  adminPermissionKey,
  operationsAdminActions,
} from "../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../lib/admin-permissions"
import { OperationsWorkspaceNavigation } from "./operations-navigation"

const renderNavigation = ({
  active = "overview",
  rbac = false,
  permissions = [],
}: {
  active?: "overview" | "refunds"
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
        <OperationsWorkspaceNavigation active={active} />
      </QueryClientProvider>
    </MemoryRouter>
  )
  queryClient.clear()
  return markup
}

describe("OperationsWorkspaceNavigation", () => {
  it("shows every workspace while RBAC is disabled", () => {
    const markup = renderNavigation()

    expect(markup).toContain(">Overview</a>")
    expect(markup).toContain(">Tax records</a>")
    expect(markup).toContain(">Refunds</a>")
    expect(markup).toContain(">Media cleanup</a>")
  })

  it("never advertises workspaces missing from the effective role", () => {
    const markup = renderNavigation({
      active: "refunds",
      permissions: [
        adminPermissionKey(operationsAdminActions.refundOperations.read),
      ],
      rbac: true,
    })

    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain(">Overview</a>")
    expect(markup).toContain(">Refunds</a>")
    expect(markup).not.toContain(">Tax records</a>")
    expect(markup).not.toContain(">Media cleanup</a>")
  })
})
