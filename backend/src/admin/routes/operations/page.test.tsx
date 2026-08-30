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
import { OperationsPage, config } from "./page"

const renderOperationsPage = ({
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
        <OperationsPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
  queryClient.clear()
  return markup
}

describe("Operations Admin route", () => {
  it("presents one overview and three clearly separated workspaces", () => {
    const markup = renderOperationsPage()

    expect(config).toMatchObject({ label: "Operations", rank: 2 })
    expect(markup).toContain(">Operations</h1>")
    expect(markup).toContain(">Tax records</h2>")
    expect(markup).toContain(">Refunds</h2>")
    expect(markup).toContain(">Media cleanup</h2>")
    expect(markup).toContain('href="/operations/tax-records"')
    expect(markup).toContain('href="/operations/refunds"')
    expect(markup).toContain('href="/operations/media-cleanup"')
    expect(markup).toContain("3 workspaces")
  })

  it("shows only the workspaces granted to a restricted role", () => {
    const markup = renderOperationsPage({
      permissions: [
        adminPermissionKey(operationsAdminActions.refundOperations.read),
      ],
      rbac: true,
    })

    expect(markup).toContain(">Refunds</h2>")
    expect(markup).not.toContain(">Tax records</h2>")
    expect(markup).not.toContain(">Media cleanup</h2>")
    expect(markup).toContain("1 workspace")
  })
})
