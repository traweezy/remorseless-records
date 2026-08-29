import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { DELETE as deleteArtist } from "@/api/admin/catalog/artists/[id]/route"
import { DELETE as deleteProductMedia } from "@/api/admin/catalog/products/[product_id]/media/route"
import { DELETE as deleteProductProfile } from "@/api/admin/catalog/products/[product_id]/profile/route"
import { DELETE as deleteReferenceValue } from "@/api/admin/catalog/reference-values/[id]/route"
import { DELETE as deleteVariantProfile } from "@/api/admin/catalog/variants/[variant_id]/profile/route"

describe("catalog hard deletion boundary", () => {
  it.each([
    ["artist", deleteArtist],
    ["reference value", deleteReferenceValue],
    ["product media", deleteProductMedia],
    ["product profile", deleteProductProfile],
    ["variant profile", deleteVariantProfile],
  ])("rejects direct %s deletion", async (_resource, handler) => {
    const json = jest.fn()
    const status = jest.fn(() => ({ json }))
    const setHeader = jest.fn()
    const type = jest.fn()

    await handler(
      {
        headers: {},
        path: "/admin/catalog/test-resource",
      } as MedusaRequest,
      {
        json,
        locals: {},
        setHeader,
        status,
        type,
      } as unknown as MedusaResponse
    )

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
    expect(type).toHaveBeenCalledWith("application/problem+json")
    expect(status).toHaveBeenCalledWith(409)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "catalog_hard_deletion_disabled",
        detail: expect.stringMatching(/^Hard deletion.+is disabled\./u),
        instance: "/admin/catalog/test-resource",
        request_id: expect.any(String),
        status: 409,
        title: "Catalog hard deletion is disabled",
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        type: "urn:remorseless-records:problem:catalog-hard-deletion-disabled",
      })
    )
  })
})
