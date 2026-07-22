import { selectSafeDuplicateProductOptions } from "./duplicate-product-options"

describe("duplicate product option repair", () => {
  it("selects only the unlinked duplicate when values match", () => {
    expect(
      selectSafeDuplicateProductOptions([
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_linked",
          values: ["Vinyl", "CD"],
          variantCount: 2,
        },
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_unlinked",
          values: ["CD", "Vinyl"],
          variantCount: 0,
        },
      ])
    ).toEqual({
      deleteIds: ["opt_unlinked"],
      productCount: 1,
      targets: [{ deleteIds: ["opt_unlinked"], productId: "prod_1" }],
    })
  })

  it("groups multiple safe duplicate titles into one product update", () => {
    expect(
      selectSafeDuplicateProductOptions([
        {
          productId: "prod_1",
          handle: "artist-album",
          title: "Format",
          optionId: "opt_format_linked",
          values: ["CD"],
          variantCount: 1,
        },
        {
          productId: "prod_1",
          handle: "artist-album",
          title: "Format",
          optionId: "opt_format_unlinked",
          values: ["CD"],
          variantCount: 0,
        },
        {
          productId: "prod_1",
          handle: "artist-album",
          title: "Edition",
          optionId: "opt_edition_linked",
          values: ["Standard"],
          variantCount: 1,
        },
        {
          productId: "prod_1",
          handle: "artist-album",
          title: "Edition",
          optionId: "opt_edition_unlinked",
          values: ["Standard"],
          variantCount: 0,
        },
      ])
    ).toEqual({
      deleteIds: ["opt_format_unlinked", "opt_edition_unlinked"],
      productCount: 1,
      targets: [
        {
          deleteIds: ["opt_format_unlinked", "opt_edition_unlinked"],
          productId: "prod_1",
        },
      ],
    })
  })

  it("rejects duplicate options when both are variant-linked", () => {
    expect(() =>
      selectSafeDuplicateProductOptions([
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_1",
          values: ["CD"],
          variantCount: 1,
        },
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_2",
          values: ["CD"],
          variantCount: 1,
        },
      ])
    ).toThrow("exactly one linked and one unlinked")
  })

  it("rejects mismatched option values", () => {
    expect(() =>
      selectSafeDuplicateProductOptions([
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_linked",
          values: ["CD"],
          variantCount: 1,
        },
        {
          productId: "prod_1",
          handle: "music-release-artist-album",
          title: "Format",
          optionId: "opt_unlinked",
          values: ["Vinyl"],
          variantCount: 0,
        },
      ])
    ).toThrow("values or variant links do not match")
  })
})
