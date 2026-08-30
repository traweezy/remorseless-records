import {
  buildCatalogAuthoringAudit,
  type CatalogAuthoringAuditBundle,
  type CatalogAuthoringAuditProduct,
  type CatalogAuthoringAuditProfile,
  type CatalogAuthoringAuditReference,
} from "./authoring-audit"

const products: CatalogAuthoringAuditProduct[] = [
  {
    handle: "release",
    id: "prod_release",
    metadata: {},
    nativeProductType: null,
    status: "published",
    title: "Release",
  },
  {
    handle: "shirt",
    id: "prod_merch",
    metadata: {},
    nativeProductType: null,
    status: "published",
    title: "Shirt",
  },
  {
    handle: "bundle",
    id: "prod_bundle",
    metadata: {},
    nativeProductType: null,
    status: "published",
    title: "Bundle",
  },
  {
    handle: "mystery",
    id: "prod_mystery",
    metadata: {},
    nativeProductType: null,
    status: "draft",
    title: "Mystery",
  },
]

const references: CatalogAuthoringAuditReference[] = [
  {
    id: "ref_release",
    isActive: true,
    kind: "product_type",
    label: "Music release",
    value: "music-release",
  },
  {
    id: "ref_merch",
    isActive: true,
    kind: "product_type",
    label: "Merch",
    value: "merch",
  },
  {
    id: "ref_bundle",
    isActive: true,
    kind: "product_type",
    label: "Fixed bundle",
    value: "fixed-bundle",
  },
  {
    id: "ref_mystery",
    isActive: true,
    kind: "product_type",
    label: "Mystery bundle",
    value: "mystery-bundle",
  },
]

const profiles: CatalogAuthoringAuditProfile[] = [
  { productId: "prod_release", productTypeId: "ref_release" },
  { productId: "prod_merch", productTypeId: "ref_merch" },
  { productId: "prod_bundle", productTypeId: "ref_bundle" },
  { productId: "prod_mystery", productTypeId: "ref_mystery" },
]

const bundles: CatalogAuthoringAuditBundle[] = [
  { bundleType: "fixed", productId: "prod_bundle" },
  { bundleType: "mystery", productId: "prod_mystery" },
]

describe("catalog authoring audit", () => {
  it("classifies all four supported product kinds without treating migration notes as blockers", () => {
    const report = buildCatalogAuthoringAudit({
      bundles,
      products,
      profiles,
      references,
    })

    expect(report.summary).toEqual({
      blockingItemCount: 0,
      byKind: {
        fixed_bundle: 1,
        merch: 1,
        music_release: 1,
        mystery_bundle: 1,
      },
      byStatus: {
        classified: 4,
        conflict: 0,
        needs_review: 0,
      },
      issueCounts: {
        native_product_type_missing: 4,
      },
      total: 4,
    })
  })

  it("makes an unclassified product an explicit review item", () => {
    const report = buildCatalogAuthoringAudit({
      bundles: [],
      products: [products[0]!],
      profiles: [],
      references,
    })

    expect(report.items[0]).toMatchObject({
      kind: null,
      status: "needs_review",
    })
    expect(report.items[0]?.issues.map(({ code }) => code)).toEqual([
      "native_product_type_missing",
      "catalog_product_type_missing",
    ])
  })

  it("reports disagreement between catalog and bundle authorities as a conflict", () => {
    const report = buildCatalogAuthoringAudit({
      bundles: [{ bundleType: "fixed", productId: "prod_release" }],
      products: [products[0]!],
      profiles: [profiles[0]!],
      references,
    })

    expect(report.items[0]).toMatchObject({
      kind: null,
      status: "conflict",
    })
    expect(report.items[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "kind_signal_conflict" })
    )
  })

  it("requires review when legacy metadata is invalid even if the controlled type is usable", () => {
    const report = buildCatalogAuthoringAudit({
      bundles: [],
      products: [
        {
          ...products[0]!,
          metadata: { authoring_kind: "record-ish" },
        },
      ],
      profiles: [profiles[0]!],
      references,
    })

    expect(report.items[0]).toMatchObject({
      kind: "music_release",
      status: "needs_review",
    })
    expect(report.items[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_authoring_kind" })
    )
  })

  it("requires review before using an archived controlled type", () => {
    const report = buildCatalogAuthoringAudit({
      bundles: [],
      products: [products[1]!],
      profiles: [profiles[1]!],
      references: references.map((reference) =>
        reference.id === "ref_merch"
          ? { ...reference, isActive: false }
          : reference
      ),
    })

    expect(report.items[0]).toMatchObject({
      kind: "merch",
      status: "needs_review",
    })
    expect(report.items[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "catalog_product_type_inactive" })
    )
  })
})
