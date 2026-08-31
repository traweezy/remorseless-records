import {
  readStoreBundleAvailability,
  readStoreBundleProducts,
} from "./store-bundle-contract"

const invalidBoundary =
  "The Store bundle projection returned invalid structured data."

describe("Store bundle projection contract", () => {
  it("preserves validated product and variant projection fields", () => {
    expect(
      readStoreBundleProducts(
        [
          {
            handle: "public-bundle",
            id: "prod_bundle",
            title: "Public Bundle",
            variants: [
              {
                id: "variant_bundle",
                sku: "bundle-sku",
                title: "Bundle",
              },
            ],
          },
        ],
        ["prod_bundle"]
      )
    ).toEqual([
      {
        handle: "public-bundle",
        id: "prod_bundle",
        title: "Public Bundle",
        variants: [
          {
            id: "variant_bundle",
            sku: "bundle-sku",
            title: "Bundle",
          },
        ],
      },
    ])
    expect(readStoreBundleProducts([], ["prod_hidden"])).toEqual([])
  })

  it.each([
    undefined,
    [null],
    [{ handle: "bundle", id: "prod_other", title: "Bundle", variants: [] }],
    [
      { handle: "bundle", id: "prod_bundle", title: "Bundle", variants: [] },
      { handle: "bundle", id: "prod_bundle", title: "Bundle", variants: [] },
    ],
    [{ handle: " bundle", id: "prod_bundle", title: "Bundle", variants: [] }],
    [{ handle: "bundle", id: "prod_bundle", title: "Bundle" }],
    [
      {
        handle: "bundle",
        id: "prod_bundle",
        title: "Bundle",
        variants: [
          { id: "variant_bundle", title: "Bundle" },
          { id: "variant_bundle", title: "Duplicate" },
        ],
      },
    ],
    [
      {
        handle: "bundle",
        id: "prod_bundle",
        title: "Bundle",
        variants: [{ id: "variant_bundle", sku: false, title: "Bundle" }],
      },
    ],
  ])("rejects malformed Store Product projections", (value) => {
    expect(() => readStoreBundleProducts(value, ["prod_bundle"])).toThrow(
      invalidBoundary
    )
  })

  it("normalizes validated availability and preserves missing rows as unknown", () => {
    expect(
      readStoreBundleAvailability(
        {
          variant_available: { availability: 12 },
          variant_unknown: { availability: null },
        },
        ["variant_available", "variant_unknown", "variant_missing"]
      )
    ).toEqual({
      variant_available: 12,
      variant_missing: null,
      variant_unknown: null,
    })
  })

  it.each([
    undefined,
    [],
    { variant_other: { availability: 1 } },
    { variant_available: null },
    { variant_available: {} },
    { variant_available: { availability: -1 } },
    { variant_available: { availability: 1.5 } },
    { variant_available: { availability: Number.POSITIVE_INFINITY } },
  ])("rejects malformed Store availability projections", (value) => {
    expect(() =>
      readStoreBundleAvailability(value, ["variant_available"])
    ).toThrow(invalidBoundary)
  })

  it("rejects malformed and duplicate expected identifiers", () => {
    expect(() => readStoreBundleProducts([], [" prod_bundle"])).toThrow(
      invalidBoundary
    )
    expect(() =>
      readStoreBundleAvailability({}, ["variant_1", "variant_1"])
    ).toThrow(invalidBoundary)
  })
})
