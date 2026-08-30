import {
  createEmptyProductAuthoringDraft,
  productAuthoringFingerprint,
  productAuthoringValidationIssues,
  type ProductAuthoringDraft,
} from "./product-authoring-form"
import { FormApi } from "@tanstack/react-form"

const draft = (): ProductAuthoringDraft => ({
  bundle: {
    bundleType: "fixed",
    components: [],
    descriptionHtml: "",
    displayTitle: "",
    enabled: false,
    fulfillmentMode: "ship_components",
    inventoryMode: "component_derived",
    isActive: true,
  },
  product: {
    description: "",
    handle: "test-release",
    status: "draft",
    title: "Test Release",
  },
  profile: {
    artists: [],
    creditsJson: "{}",
    descriptionHtml: "",
    labelId: "label_1",
    labelLabel: "Remorseless Records",
    merchDetailsJson: "{}",
    pressingNotesJson: "{}",
    productTypeId: "type_1",
    productTypeLabel: "Music release",
    references: [],
    releaseDate: "2030-01-01",
    releaseTitle: "Test Release",
    releaseYear: "2030",
    searchKeywords: "test",
    tracklistJson: "[]",
  },
  variants: [
    {
      availabilityStatus: "available",
      backorderAllowed: false,
      backorderNote: "",
      displayLabel: "Vinyl",
      formatDetailId: "",
      formatDetailLabel: "Black",
      formatId: "format_1",
      formatLabel: "Vinyl",
      imageUrl: "",
      preorderReleaseDate: "",
      variantId: "variant_1",
      version: 1,
    },
  ],
})

describe("Product authoring form", () => {
  it("creates isolated empty defaults for each form instance", () => {
    const first = createEmptyProductAuthoringDraft()
    const second = createEmptyProductAuthoringDraft()
    first.profile.artists.push({
      artistId: "artist_1",
      displayName: "Test Artist",
      key: "artist_line_1",
      name: "Test Artist",
      role: "primary",
    })
    first.bundle.components.push({
      componentProductId: "product_1",
      componentVariantId: "",
      key: "component_1",
      quantity: "1",
      sku: "",
      title: "Test Product",
      variantTitle: "",
    })

    expect(second.profile.artists).toEqual([])
    expect(second.bundle.components).toEqual([])
  })

  it("retains a hydrated snapshot when form options update", () => {
    jest.useFakeTimers()
    const defaultValues = createEmptyProductAuthoringDraft()
    const form = new FormApi({ defaultValues })
    const unmount = form.mount()
    const hydrated = draft()

    try {
      form.reset(hydrated, { keepDefaultValues: true })
      form.update({ defaultValues })

      expect(form.state.values).toEqual(hydrated)
    } finally {
      unmount()
      jest.advanceTimersByTime(6_000)
      jest.useRealTimers()
    }
  })

  it("accepts an ordinary release draft", () => {
    expect(productAuthoringValidationIssues(draft())).toEqual([])
  })

  it("maps invalid fields and task groups to focus targets", () => {
    const value = draft()
    value.product.title = ""
    value.profile.releaseYear = "20x6"
    value.profile.tracklistJson = "{}"
    value.variants[0]!.formatLabel = ""
    const issues = productAuthoringValidationIssues(value)
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "product-authoring-title" }),
        expect.objectContaining({ targetId: "product-authoring-release-year" }),
        expect.objectContaining({ targetId: "product-authoring-tracklist" }),
        expect.objectContaining({ targetId: "product-authoring-variants" }),
      ])
    )
  })

  it("requires safe bundle quantities and preorder dates", () => {
    const value = draft()
    value.bundle.enabled = true
    value.bundle.components = [
      {
        componentProductId: "",
        componentVariantId: "",
        key: "component_1",
        quantity: "0",
        sku: "",
        title: "",
        variantTitle: "",
      },
    ]
    value.variants[0]!.availabilityStatus = "preorder"
    expect(
      productAuthoringValidationIssues(value).map(({ message }) => message)
    ).toEqual(
      expect.arrayContaining([
        "Choose a release time for a preorder variant.",
        "Choose an included product.",
        "Quantity must be a whole number of at least 1.",
      ])
    )
  })

  it("produces a stable dirty-state fingerprint", () => {
    const value = draft()
    const before = productAuthoringFingerprint(value)
    expect(productAuthoringFingerprint({ ...value })).toBe(before)
    expect(
      productAuthoringFingerprint({
        ...value,
        product: { ...value.product, title: "Changed" },
      })
    ).not.toBe(before)
  })
})
