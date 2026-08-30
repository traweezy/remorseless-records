import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"

import { adminPermissionKey } from "../../../lib/admin-permissions"
import { catalogProductListGuideActions } from "../catalog-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../lib/admin-permissions"
import { catalogAuthoringAuditQueryKey } from "./catalog-authoring-audit-query"
import { CatalogProductListGuideWidget } from "./catalog-product-list-guide-widget"

const catalogAuthoringAuditPayloadFixture = {
  filteredCount: 462,
  generatedAt: "2026-08-30T12:00:00.000Z",
  items: [],
  limit: 1,
  offset: 0,
  summary: {
    blockingItemCount: 0,
    byKind: {
      fixed_bundle: 14,
      merch: 5,
      music_release: 442,
      mystery_bundle: 1,
    },
    byStatus: {
      classified: 462,
      conflict: 0,
      needs_review: 0,
    },
    issueCounts: { native_product_type_missing: 462 },
    total: 462,
  },
} as const

describe("CatalogProductListGuideWidget", () => {
  it("renders actionable catalog health on the native product list", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
    queryClient.setQueryData(adminPermissionsQueryKey, {
      permissions: catalogProductListGuideActions.map(adminPermissionKey),
    })
    queryClient.setQueryData(
      catalogAuthoringAuditQueryKey,
      catalogAuthoringAuditPayloadFixture
    )

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CatalogProductListGuideWidget />
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(markup).toContain("Catalog workspace")
    expect(markup).toContain('id="catalog-product-list-guide"')
    expect(markup).toContain("Catalog consistent")
    expect(markup).toContain("462")
    expect(markup).toContain("442")
    expect(markup).toContain("20")
    expect(markup).toContain('href="/products/create"')
    expect(markup).toContain('href="/catalog-authoring"')
    queryClient.clear()
  })

  it("does not load catalog health without both read permissions", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
    queryClient.setQueryData(adminPermissionsQueryKey, {
      permissions: catalogProductListGuideActions
        .slice(0, -1)
        .map(adminPermissionKey),
    })

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CatalogProductListGuideWidget />
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(markup).toBe("")
    expect(
      queryClient.getQueryState(catalogAuthoringAuditQueryKey)
    ).toBeUndefined()
    queryClient.clear()
  })
})
