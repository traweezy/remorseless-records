import { catalogProductCreateSchema } from "./product-create-contract"

const idempotencyKey = "00000000-0000-4000-8000-000000000001"

const musicRelease = () => ({
  idempotencyKey,
  kind: "music_release",
  title: "A New Record",
  handle: "a-new-record",
  options: [{ title: "Format", values: ["CD", "LP"] }],
  variants: [
    {
      key: "cd",
      title: "CD",
      sku: "",
      options: { Format: "CD" },
      prices: [{ amount: 12, currencyCode: "USD" }],
      stockQuantity: 8,
      profile: { format: { label: "CD" }, displayLabel: "CD" },
    },
    {
      key: "lp",
      title: "LP",
      sku: "",
      options: { Format: "LP" },
      prices: [{ amount: 24, currencyCode: "usd" }],
      stockQuantity: 0,
      profile: { format: { label: "LP" }, displayLabel: "LP" },
    },
  ],
  profile: {
    artists: [{ name: "The Artist", role: "primary" }],
    productType: { label: "Music Release" },
  },
})

describe("catalogProductCreateSchema", () => {
  it("accepts a multi-format music draft and normalizes currency codes", () => {
    const parsed = catalogProductCreateSchema.parse(musicRelease())

    expect(parsed.variants).toHaveLength(2)
    expect(parsed.variants[0]?.prices[0]?.currencyCode).toBe("usd")
    expect(parsed.variants[1]?.stockQuantity).toBe(0)
  })

  it("accepts merchandise with managed inventory", () => {
    expect(
      catalogProductCreateSchema.safeParse({
        ...musicRelease(),
        kind: "merch",
        profile: { productType: { label: "T-shirt" } },
      }).success,
    ).toBe(true)
  })

  it("accepts fixed component-derived and mystery manual bundles", () => {
    const commonBundle = {
      ...musicRelease(),
      profile: { productType: { label: "Bundle" } },
      options: [{ title: "Format", values: ["Bundle"] }],
      variants: [
        {
          key: "bundle",
          title: "Bundle",
          options: { Format: "Bundle" },
          prices: [{ amount: 30, currencyCode: "usd" }],
          profile: { displayLabel: "Bundle" },
        },
      ],
    }

    expect(
      catalogProductCreateSchema.safeParse({
        ...commonBundle,
        kind: "fixed_bundle",
        bundle: {
          components: [
            {
              componentProductId: "prod_component",
              componentVariantId: "variant_component",
              quantity: 2,
            },
          ],
        },
      }).success,
    ).toBe(true)

    expect(
      catalogProductCreateSchema.safeParse({
        ...commonBundle,
        kind: "mystery_bundle",
        variants: [
          {
            ...commonBundle.variants[0],
            stockQuantity: 5,
          },
        ],
        bundle: { components: [] },
      }).success,
    ).toBe(true)
  })

  it("rejects missing kind-specific fields and invalid inventory ownership", () => {
    const withoutArtist = musicRelease()
    withoutArtist.profile.artists = []
    expect(catalogProductCreateSchema.safeParse(withoutArtist).success).toBe(
      false,
    )

    expect(
      catalogProductCreateSchema.safeParse({
        ...musicRelease(),
        kind: "fixed_bundle",
        bundle: { components: [] },
      }).success,
    ).toBe(false)

    expect(
      catalogProductCreateSchema.safeParse({
        ...musicRelease(),
        kind: "mystery_bundle",
        bundle: {
          components: [
            {
              componentProductId: "prod_component",
              componentVariantId: "variant_component",
            },
          ],
        },
      }).success,
    ).toBe(false)

    const fixedWithOwnedStock = {
      ...musicRelease(),
      kind: "fixed_bundle",
      profile: { productType: { label: "Bundle" } },
      bundle: {
        components: [
          {
            componentProductId: "prod_component",
            componentVariantId: "variant_component",
          },
        ],
      },
    }
    expect(
      catalogProductCreateSchema.safeParse(fixedWithOwnedStock).success,
    ).toBe(false)
  })

  it("rejects malformed option, SKU, price, and component combinations", () => {
    const duplicateCombination = musicRelease()
    duplicateCombination.variants[1]!.options.Format = "CD"
    duplicateCombination.variants[1]!.sku = "same"
    duplicateCombination.variants[0]!.sku = "SAME"
    duplicateCombination.variants[1]!.prices.push({
      amount: 25,
      currencyCode: "USD",
    })
    expect(
      catalogProductCreateSchema.safeParse(duplicateCombination).success,
    ).toBe(false)

    const unknownOption = musicRelease()
    unknownOption.variants[0]!.options = { Size: "Large" } as unknown as {
      Format: string
    }
    expect(catalogProductCreateSchema.safeParse(unknownOption).success).toBe(
      false,
    )

    const duplicateComponent = {
      ...musicRelease(),
      kind: "fixed_bundle",
      profile: { productType: { label: "Bundle" } },
      variants: [
        {
          key: "bundle",
          title: "Bundle",
          options: { Format: "CD" },
          prices: [{ amount: 30, currencyCode: "usd" }],
        },
      ],
      bundle: {
        components: [
          {
            componentProductId: "prod_component",
            componentVariantId: "variant_component",
          },
          {
            componentProductId: "prod_component",
            componentVariantId: "variant_component",
          },
        ],
      },
    }
    expect(catalogProductCreateSchema.safeParse(duplicateComponent).success).toBe(
      false,
    )
  })

  it("requires every fixed-bundle offering to have a valid component mapping", () => {
    const base = musicRelease()
    const fixed = {
      ...base,
      kind: "fixed_bundle",
      profile: { productType: { label: "Bundle" } },
      variants: base.variants.map(({ stockQuantity: _stock, ...variant }) =>
        variant,
      ),
      bundle: {
        components: [
          {
            bundleVariantKeys: ["cd"],
            componentProductId: "component_product",
            componentVariantId: "component_variant",
          },
        ],
      },
    }

    expect(catalogProductCreateSchema.safeParse(fixed).success).toBe(false)
    expect(
      catalogProductCreateSchema.safeParse({
        ...fixed,
        bundle: {
          components: [
            {
              ...fixed.bundle.components[0],
              bundleVariantKeys: ["cd", "unknown"],
            },
          ],
        },
      }).success,
    ).toBe(false)
    expect(
      catalogProductCreateSchema.safeParse({
        ...fixed,
        bundle: {
          components: [
            {
              ...fixed.bundle.components[0],
              bundleVariantKeys: ["cd", "lp"],
            },
          ],
        },
      }).success,
    ).toBe(true)
  })
})
