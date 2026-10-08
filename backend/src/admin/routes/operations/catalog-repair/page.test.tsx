import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { adminPermissionKey } from "../../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../../lib/admin-permissions"
import { savedRepairSchema } from "./command-state"
import {
  CatalogRepairPage,
  CatalogRepairReview,
  catalogRepairApplyActions,
  catalogRepairReadActions,
  handle,
} from "./page"
import type { RepairPreview } from "./query"

const renderPage = (permissions: string[] | null, pending = false): string => {
  const client = new QueryClient()
  if (!pending) {
    client.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
    if (permissions)
      client.setQueryData(adminPermissionsQueryKey, { permissions })
  }
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CatalogRepairPage />
    </QueryClientProvider>
  )
  client.clear()
  return markup
}
const preview: RepairPreview = {
  actorId: "user_original",
  manifestSha256: "b".repeat(64),
  manifest: {
    schemaVersion: 1,
    creationOperationId: "catop_creation",
    productId: "prod_missing",
    nativeProductAbsent: true,
    nativeVariantsAbsent: ["variant_missing"],
    creation: {
      id: "catop_creation",
      status: "compensated",
      rowSha256: "c".repeat(64),
    },
    profile: { id: "cprof_leftover", version: 1, rowSha256: "d".repeat(64) },
    variants: [
      {
        id: "cvprof_leftover",
        variantId: "variant_missing",
        version: 1,
        rowSha256: "e".repeat(64),
      },
    ],
    media: [
      {
        id: "cpmedia_leftover",
        assetId: "cmedia_retained",
        rowSha256: "f".repeat(64),
      },
    ],
    assets: [{ id: "cmedia_retained", version: 2, rowSha256: "0".repeat(64) }],
    children: [
      {
        id: "catop_profile",
        command: "catalog.product-profile.upsert",
        status: "succeeded",
        rowSha256: "1".repeat(64),
      },
      {
        id: "catop_variant",
        command: "catalog.variant-profile.upsert",
        status: "succeeded",
        rowSha256: "2".repeat(64),
      },
      {
        id: "catop_media",
        command: "catalog.product-media.replace",
        status: "succeeded",
        rowSha256: "3".repeat(64),
      },
    ],
  },
}

describe("native Admin Catalog repair permission and review UI", () => {
  it.each(catalogRepairReadActions)(
    "requires each conjunctive preview permission %# before mounting the form",
    (missing) => {
      const keys = catalogRepairReadActions
        .filter((action) => action !== missing)
        .map(adminPermissionKey)
      const markup = renderPage(keys)
      expect(markup).toContain("Access restricted")
      expect(markup).not.toContain("Creation operation")
      expect(markup).not.toContain("Preview repair")
      expect(markup).not.toContain("prod_missing")
    }
  )

  it.each([true, false])(
    "does not reveal the command form while role verification is pending %#",
    (flagsPending) => {
      const markup = renderPage(null, flagsPending)
      expect(markup).toContain('aria-label="Checking access"')
      expect(markup).not.toContain("Creation operation")
      expect(markup).not.toContain("Preview repair")
    }
  )

  it("allows read-only preview access without converting it to mutation permissions", () => {
    const keys = catalogRepairReadActions.map(adminPermissionKey)
    const markup = renderPage(keys)
    expect(markup).toContain(">Catalog repair</h1>")
    expect(markup).toContain("Creation operation")
    expect(markup).toContain("Product identifier")
    expect(markup).toContain("Backend revision")
    expect(markup).toContain("Preview repair")
    expect(markup).not.toContain("Apply reviewed repair")
    expect(markup).not.toContain("Retry saved request")
    expect(markup).toContain('disabled=""')
    expect(handle.permissions).toEqual(keys)
    expect(catalogRepairApplyActions.map(adminPermissionKey)).toEqual([
      "catalog_authoring:update",
      "catalog_authoring:delete",
    ])
  })

  it("shows the exact retained-versus-removed identifiers without raw row or provider payloads", () => {
    const markup = renderToStaticMarkup(
      <CatalogRepairReview preview={preview} record={null} />
    )
    expect(markup).toContain("Reviewed catalog records")
    expect(markup).toContain(
      "1 variant profiles and 1 media links will be removed"
    )
    expect(markup).toContain("1 managed media files are retained")
    for (const id of [
      "cprof_leftover",
      "cvprof_leftover",
      "cpmedia_leftover",
      "cmedia_retained",
    ])
      expect(markup).toContain(id)
    expect(markup).toContain('class="break-all"')
    expect(markup).toContain("b".repeat(64))
    expect(markup).not.toContain("rowSha256")
    expect(markup).not.toContain("c".repeat(64))
    expect(markup).not.toContain("user_original")
  })

  it("uses the saved plan for an uncertain reload and displays its immutable request identity", () => {
    const record = savedRepairSchema.parse({
      version: 1,
      context: {
        backendOrigin: "https://admin.example.test",
        creationOperationId: "catop_creation",
        productId: "prod_missing",
        sha: "a".repeat(40),
      },
      body: {
        productId: "prod_missing",
        sha: "a".repeat(40),
        expectedActorId: "user_original",
        expectedManifestSha256: "b".repeat(64),
        idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
      },
      expectedIds: {
        profileId: "cprof_leftover",
        variantProfileIds: ["cvprof_leftover"],
        mediaLinkIds: ["cpmedia_leftover"],
        retainedAssetIds: ["cmedia_retained"],
      },
      status: "uncertain",
      result: null,
    })
    const markup = renderToStaticMarkup(
      <CatalogRepairReview preview={null} record={record} />
    )
    expect(markup).toContain(record.body.idempotencyKey)
    expect(markup).toContain("Reviewed catalog records")
    expect(markup).not.toContain("Repair confirmed")
    const confirmed = savedRepairSchema.parse({
      ...record,
      status: "succeeded",
      result: {
        operationId: "catop_repair",
        replayed: true,
        result: {
          creationOperationId: "catop_creation",
          productId: "prod_missing",
          manifestSha256: "b".repeat(64),
          ...record.expectedIds,
        },
      },
    })
    const confirmedMarkup = renderToStaticMarkup(
      <CatalogRepairReview preview={null} record={confirmed} />
    )
    expect(confirmedMarkup).toContain("Repair confirmed")
    expect(confirmedMarkup).toContain("were removed")
    expect(confirmedMarkup).not.toContain("will be removed")
    expect(confirmedMarkup).toContain("catop_repair")
  })
})
