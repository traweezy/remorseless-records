import {
  adminProductListResponseSchema,
  adminProductResponseSchema,
  bundleResponseSchema,
  variantProfileResponseSchema,
} from "./catalog-authoring-response"

describe("catalog authoring response contracts", () => {
  it("projects bounded product data and rejects duplicate identities", () => {
    expect(
      adminProductResponseSchema.parse({
        ignored: "provider detail",
        product: {
          id: "prod_01",
          ignored: "provider detail",
          title: "Catalog title",
          variants: [{ id: "variant_01", title: "LP" }],
        },
      })
    ).toEqual({
      product: {
        id: "prod_01",
        title: "Catalog title",
        variants: [{ id: "variant_01", title: "LP" }],
      },
    })

    expect(
      adminProductListResponseSchema.safeParse({
        count: 2,
        products: [{ id: "prod_01" }, { id: "prod_01" }],
      }).success
    ).toBe(false)
  })

  it("fails closed on unknown variant states and duplicate components", () => {
    expect(
      variantProfileResponseSchema.safeParse({
        profile: {
          availabilityStatus: "invented",
          backorderAllowed: false,
          backorderNote: null,
          displayLabel: null,
          formatDetailId: null,
          formatDetailLabel: null,
          formatId: null,
          formatLabel: null,
          id: "variant_profile_01",
          imageUrl: null,
          preorderReleaseDate: null,
          productProfileId: null,
          variantId: "variant_01",
          version: 1,
        },
      }).success
    ).toBe(false)

    const component = {
      componentInventoryItemId: null,
      componentProductId: "prod_component",
      componentVariantId: null,
      id: "bundle_component_01",
      isRequired: true,
      quantity: 1,
      sku: null,
      sortOrder: 0,
      title: "Component",
      variantTitle: null,
    }
    expect(
      bundleResponseSchema.safeParse({
        bundle: null,
        components: [component, component],
      }).success
    ).toBe(false)
  })
})
