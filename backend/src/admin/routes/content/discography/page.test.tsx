import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import {
  adminPermissionKey,
  contentAdminActions,
  nativeAdminActions,
} from "../../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../../lib/admin-permissions"
import { discographyReadActions } from "../../../features/content/content-permissions"
import DiscographyPage, { handle } from "./page"

const renderDiscographyPage = (permissions: readonly string[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
  queryClient.setQueryData(adminPermissionsQueryKey, { permissions })

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DiscographyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  const protectedQueries = queryClient.getQueryCache().findAll({
    queryKey: ["discography"],
  })
  queryClient.clear()

  return { markup, protectedQueries }
}

describe("Discography Admin route permissions", () => {
  it("keeps route metadata compatible and declares the page conjunction", () => {
    expect(handle.permissions).toBe(
      adminPermissionKey(contentAdminActions.discography.read),
    )
    expect(discographyReadActions.map(adminPermissionKey)).toEqual([
      adminPermissionKey(contentAdminActions.discography.read),
      adminPermissionKey(nativeAdminActions.product.read),
    ])
  })

  it.each([
    {
      name: "Discography read without Product read",
      permissions: [
        adminPermissionKey(contentAdminActions.discography.read),
      ],
    },
    {
      name: "Product read without Discography read",
      permissions: [adminPermissionKey(nativeAdminActions.product.read)],
    },
  ])("fails closed for $name before registering a protected query", ({ permissions }) => {
    const { markup, protectedQueries } = renderDiscographyPage(permissions)

    expect(markup).toContain("Access restricted")
    expect(markup).toContain("No protected content was loaded")
    expect(protectedQueries).toHaveLength(0)
  })

  it("mounts the protected query only with the complete read capability", () => {
    const { markup, protectedQueries } = renderDiscographyPage([
      adminPermissionKey(contentAdminActions.discography.read),
      adminPermissionKey(nativeAdminActions.product.read),
    ])

    expect(markup).not.toContain("Access restricted")
    expect(protectedQueries.length).toBeGreaterThan(0)
  })
})
