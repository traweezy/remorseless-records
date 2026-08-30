import { requestAdminJson } from "../../lib/admin-request"
import {
  loadVariantCatalogProfile,
  saveVariantCatalogProfile,
} from "./variant-catalog-profile-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}))

describe("Variant catalog profile query boundary", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset()
  })

  it("loads the profile, controlled choices, and release date together", async () => {
    jest
      .mocked(requestAdminJson)
      .mockResolvedValueOnce({ profile: null })
      .mockResolvedValueOnce({ values: [] })
      .mockResolvedValueOnce({
        profile: { releaseDate: "2030-01-01T00:00:00.000Z" },
      })
    await expect(
      loadVariantCatalogProfile({
        productId: "product/1",
        variantId: "variant/1",
      })
    ).resolves.toEqual({
      profile: null,
      references: [],
      releaseDate: "2030-01-01T00:00:00.000Z",
    })
    expect(requestAdminJson).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "/admin/catalog/variants/variant%2F1/profile",
      })
    )
    expect(requestAdminJson).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: "/admin/catalog/products/product%2F1/profile",
      })
    )
  })

  it("sends one versioned idempotent write", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue({ profile: null })
    await saveVariantCatalogProfile({
      expectedVersion: 2,
      idempotencyKey: "idem_1",
      payload: {
        backorderAllowed: false,
        backorderNote: null,
        displayLabel: null,
        formatDetailId: null,
        formatDetailLabel: null,
        formatId: null,
        formatLabel: "Vinyl",
        imageUrl: null,
        metadata: {},
        preorderAllowed: false,
        preorderReleaseDate: null,
        productId: "product_1",
      },
      variantId: "variant_1",
    })
    expect(requestAdminJson).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          expectedVersion: 2,
          idempotencyKey: "idem_1",
        }),
        method: "PUT",
        path: "/admin/catalog/variants/variant_1/profile",
      })
    )
  })
})
