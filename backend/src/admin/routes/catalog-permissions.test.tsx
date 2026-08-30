import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import {
  adminPermissionKey,
  catalogAdminActions,
} from "../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../lib/admin-permissions"
import CatalogMerchandisingPage, {
  handle as merchandisingHandle,
} from "./catalog-merchandising/page"
import CatalogProductCreatePage, {
  handle as createHandle,
} from "./products/create/page"
import CatalogProductEditorPage, {
  handle as editorHandle,
} from "./catalog/products/[product_id]/page"

type ProtectedCatalogRoute = {
  Component: ComponentType
  handle: { permissions: string }
  marker: string
  name: string
  path: string
  primaryPermission: string
  routePattern: string
}

const protectedCatalogRoutes: readonly ProtectedCatalogRoute[] = [
  {
    Component: CatalogProductCreatePage,
    handle: createHandle,
    marker: "Build a draft through one validated workflow",
    name: "Catalog product creation",
    path: "/products/create",
    primaryPermission: adminPermissionKey(catalogAdminActions.authoring.create),
    routePattern: "/products/create",
  },
  {
    Component: CatalogProductEditorPage,
    handle: editorHandle,
    marker: "Edit the catalog presentation for this Medusa product",
    name: "Catalog Authoring",
    path: "/catalog/products/prod_01",
    primaryPermission: adminPermissionKey(catalogAdminActions.authoring.read),
    routePattern: "/catalog/products/:product_id",
  },
  {
    Component: CatalogMerchandisingPage,
    handle: merchandisingHandle,
    marker: "Create shelf",
    name: "Catalog Merchandising",
    path: "/catalog-merchandising",
    primaryPermission: adminPermissionKey(
      catalogAdminActions.merchandising.read,
    ),
    routePattern: "/catalog-merchandising",
  },
] as const

const renderDeniedRoute = ({
  Component,
  path,
  routePattern,
}: Pick<ProtectedCatalogRoute, "Component" | "path" | "routePattern">): {
  catalogQueryKeys: readonly (readonly unknown[])[]
  markup: string
} => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
  queryClient.setQueryData(adminPermissionsQueryKey, { permissions: [] })

  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route element={<Component />} path={routePattern} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  const catalogQueryKeys = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter((queryKey) => queryKey.at(0) === "catalog")
  queryClient.clear()

  return { catalogQueryKeys, markup }
}

describe("Catalog Admin route permissions", () => {
  it.each(protectedCatalogRoutes)(
    "declares the $name primary route permission",
    ({ handle, primaryPermission }) => {
      expect(handle.permissions).toBe(primaryPermission)
    },
  )

  it.each(protectedCatalogRoutes)(
    "fails closed before mounting the $name workspace",
    ({ Component, marker, name, path, routePattern }) => {
      const { catalogQueryKeys, markup } = renderDeniedRoute({
        Component,
        path,
        routePattern,
      })

      expect(markup).toContain("Access restricted")
      expect(markup).toContain("No protected content was loaded")
      expect(markup).toContain(`${name} workspace`)
      expect(markup).not.toContain(marker)
      expect(catalogQueryKeys).toEqual([])
    },
  )
})
