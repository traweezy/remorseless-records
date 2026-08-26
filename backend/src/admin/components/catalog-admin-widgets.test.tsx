import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { adminPermissionKey } from "../../lib/admin-permissions"
import { catalogVariantProfileActions } from "../features/catalog-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../lib/admin-permissions"
import { VariantCatalogProfileWidget } from "./catalog-admin-widgets"

const renderVariantWidget = (permissions: readonly string[]): string => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
  queryClient.setQueryData(adminPermissionsQueryKey, { permissions })

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <VariantCatalogProfileWidget
        data={{ id: "variant_01", product_id: "prod_01" }}
      />
    </QueryClientProvider>,
  )
  queryClient.clear()
  return markup
}

describe("VariantCatalogProfileWidget", () => {
  it("renders for a role with the complete capability contract", () => {
    const markup = renderVariantWidget(
      catalogVariantProfileActions.map(adminPermissionKey),
    )

    expect(markup).toContain("Catalog variant profile")
    expect(markup).toContain("Edit catalog variant")
  })

  it("stays hidden when any capability is missing", () => {
    const markup = renderVariantWidget(
      catalogVariantProfileActions.slice(0, -1).map(adminPermissionKey),
    )

    expect(markup).toBe("")
    expect(markup).not.toContain("Catalog variant profile")
  })
})
