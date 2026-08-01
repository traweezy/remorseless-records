import { z } from "zod"

import {
  catalogProductCreateResponseSchema,
  createCatalogProduct,
} from "./catalog-product-create-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(async (input: { schema: z.ZodType }) =>
    input.schema.parse({
      kind: "music_release",
      productId: "product_1",
      profileId: "profile_1",
      replayed: false,
      variantIds: ["variant_1"],
    }),
  ),
}))

describe("catalog product creation query", () => {
  it("validates the command response", () => {
    expect(
      catalogProductCreateResponseSchema.safeParse({
        kind: "music_release",
        productId: "product_1",
        profileId: "profile_1",
        replayed: false,
        variantIds: ["variant_1"],
      }).success,
    ).toBe(true)
    expect(
      catalogProductCreateResponseSchema.safeParse({
        kind: "music_release",
        productId: "",
        profileId: "profile_1",
        replayed: false,
        variantIds: [],
      }).success,
    ).toBe(false)
  })

  it("uses the atomic Admin command with its longer workflow timeout", async () => {
    const response = await createCatalogProduct({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      kind: "music_release",
      options: [{ title: "Format", values: ["CD"] }],
      profile: {},
      title: "Record",
      variants: [
        {
          allowBackorder: false,
          key: "cd",
          options: { Format: "CD" },
          prices: [{ amount: 10, currencyCode: "usd" }],
          profile: {},
          stockQuantity: 1,
          title: "CD",
        },
      ],
    })

    expect(response.productId).toBe("product_1")
  })
})
