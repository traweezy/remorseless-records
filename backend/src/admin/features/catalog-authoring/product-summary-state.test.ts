import type { ProductAuthoringView } from "./product-authoring-query"
import { buildProductCatalogSummary } from "./product-summary-state"

const buildView = (
  overrides: Partial<ProductAuthoringView> = {}
): ProductAuthoringView => ({
  catalog: {
    artists: [
      {
        artist: { id: "cartist_01", name: "Test Artist" },
        assignment: { displayName: "Test Artist", role: "primary" },
      },
    ],
    bundle: null,
    label: { id: "cref_label", label: "Remorseless Records" },
    media: [
      {
        asset: { altText: null, lifecycleStatus: "active" },
        isPrimary: true,
        mediaAssetId: "cmedia_01",
      },
    ],
    productType: { id: "cref_type", label: "Music release" },
    profile: {
      id: "cprod_01",
      releaseDate: "2026-01-01T00:00:00.000Z",
      releaseDatePrecision: "day",
      releaseTitle: "Test Release",
      releaseYear: 2026,
    },
    variants: [
      {
        format: { id: "cref_format", label: "CD" },
        formatDetail: null,
        status: {
          customerStatus: "low_stock",
          inventoryQuantity: 4,
          inventoryStatus: "low_stock",
          reason: "Only 4 units remain.",
        },
        variantId: "variant_01",
      },
      {
        format: { id: "cref_format", label: "LP" },
        formatDetail: null,
        status: {
          customerStatus: "sold_out",
          inventoryQuantity: 0,
          inventoryStatus: "sold_out",
          reason: "The exact available inventory is zero.",
        },
        variantId: "variant_02",
      },
    ],
  },
  classification: {
    issues: [],
    kind: "music_release",
    status: "classified",
  },
  commerce: {
    handle: "test-release",
    id: "prod_01",
    status: "published",
    title: "Test Release",
    variants: [
      { id: "variant_01", title: "CD" },
      { id: "variant_02", title: "LP" },
    ],
  },
  diagnostics: {
    duplicateBundleProfileIds: [],
    duplicateProductProfileIds: [],
    inventoryAvailability: "available",
    missingArtistIds: [],
    missingMediaAssetIds: [],
    missingReferenceValueIds: [],
    missingVariantProfileIds: [],
    orphanVariantProfileIds: [],
  },
  ...overrides,
})

describe("product catalog summary", () => {
  it("summarizes mixed offering stock without hiding sold-out formats", () => {
    const summary = buildProductCatalogSummary(buildView())

    expect(summary.kindLabel).toBe("Music release")
    expect(summary.artistLabel).toBe("Test Artist")
    expect(summary.availability).toEqual({
      color: "orange",
      description: "1 low stock offering · 1 sold out offering",
      label: "Low stock",
    })
    expect(summary.media).toEqual({
      description: "1 image missing alternative text",
      missingAltText: 1,
      total: 1,
    })
  })

  it("marks conflicting catalog records as blocked", () => {
    const base = buildView()
    const summary = buildProductCatalogSummary(
      buildView({
        classification: {
          issues: [
            {
              code: "kind_signal_conflict",
              message: "Classification sources disagree.",
              severity: "error",
            },
          ],
          kind: null,
          status: "conflict",
        },
        diagnostics: {
          ...base.diagnostics,
          duplicateProductProfileIds: ["cprod_duplicate"],
        },
      })
    )

    expect(summary.completion.label).toBe("Blocked")
    expect(summary.completion.color).toBe("red")
    expect(summary.kindLabel).toBe("Unclassified")
  })

  it("explains mystery-box inventory without requiring component mappings", () => {
    const base = buildView()
    const summary = buildProductCatalogSummary(
      buildView({
        catalog: {
          ...base.catalog,
          bundle: {
            components: [],
            profile: {
              bundleType: "mystery",
              id: "cbundle_01",
              isActive: true,
            },
          },
        },
        classification: {
          issues: [],
          kind: "mystery_bundle",
          status: "classified",
        },
      })
    )

    expect(summary.bundleHealth).toEqual({
      color: "blue",
      description:
        "Mystery boxes use native manual inventory and do not require component mappings.",
      label: "Manual inventory",
    })
  })
})
