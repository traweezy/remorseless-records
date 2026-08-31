import type {
  CatalogBundleComponentState,
  CatalogBundleInventoryLinkState,
  CatalogBundleProfileState,
} from "@/modules/catalog/bundle-authoring"

import {
  assertExactCatalogBundleSnapshot,
  readCatalogBundleOperationResult,
  readCatalogBundleProfileMutation,
  readCatalogBundleStatePage,
  readCatalogBundleStateProfiles,
  readCatalogMediaAsset,
  readCatalogMediaAssetMutation,
  readCatalogMediaAssets,
  readCatalogMediaLifecycleOperationResult,
  readCatalogMediaUploadOperationResult,
  readCatalogProductMediaItems,
  readCatalogProductMediaOperationResult,
  readCatalogTransactionOperationList,
  readCatalogTransactionOperationMutation,
  readExactCatalogBundleComponents,
  readExactCatalogBundleInventoryLinks,
  readExactCatalogProductMediaItems,
} from "./transaction-persistence-contracts"
import {
  catalogMediaAssetFixture,
  catalogOperationFixture,
  catalogProductMediaItemFixture,
} from "./transaction-persistence-fixtures.test-helpers"

const bundleProfile = (
  overrides: Partial<CatalogBundleProfileState> = {}
): CatalogBundleProfileState => ({
  bundle_type: "fixed",
  description_html: null,
  display_title: "Starter set",
  fulfillment_mode: "ship_components",
  id: "cbundle_1",
  inventory_mode: "component_derived",
  is_active: true,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  version: 1,
  ...overrides,
})

const bundleComponent = (
  overrides: Partial<CatalogBundleComponentState> = {}
): CatalogBundleComponentState => ({
  bundle_profile_id: "cbundle_1",
  component_inventory_item_id: "iitem_1",
  component_product_id: "prod_2",
  component_variant_id: "variant_2",
  id: "cbcomp_1",
  is_required: true,
  metadata: {},
  quantity: 2,
  sku: "COMP-2",
  sort_order: 0,
  title: "Component",
  variant_title: "Black",
  ...overrides,
})

const inventoryLink = (
  overrides: Partial<Required<CatalogBundleInventoryLinkState>> = {}
): Required<CatalogBundleInventoryLinkState> => ({
  bundle_profile_id: "cbundle_1",
  bundle_variant_id: "variant_bundle_1",
  id: "cbilink_1",
  inventory_item_id: "iitem_1",
  metadata: {},
  required_quantity: 2,
  ...overrides,
})

describe("catalog media persistence contracts", () => {
  it("accepts a complete active media projection", () => {
    expect(
      readCatalogMediaAsset(catalogMediaAssetFixture(), "cmedia_1")
    ).toEqual(
      expect.objectContaining({
        id: "cmedia_1",
        lifecycle_status: "active",
        version: 1,
      })
    )
  })

  it.each([
    { source_url: "javascript:alert(1)" },
    { lifecycle_status: "active", quarantined_at: "2026-08-30T00:00:00Z" },
    { content_sha256: "not-a-sha" },
    { focal_x: 1.1 },
    { metadata: { nested: { value: "x".repeat(10_001) } } },
  ])("rejects malformed media state %#", (override) => {
    expect(() =>
      readCatalogMediaAsset(catalogMediaAssetFixture(override))
    ).toThrow("transaction persistence boundary")
  })

  it("rejects duplicate, unexpected, and missing batch assets", () => {
    expect(() =>
      readCatalogMediaAssets(
        [catalogMediaAssetFixture(), catalogMediaAssetFixture()],
        { maximumRows: 2 }
      )
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogMediaAssets([catalogMediaAssetFixture()], {
        expectedIds: ["cmedia_other"],
        maximumRows: 1,
      })
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogMediaAssets([], {
        expectedIds: ["cmedia_1"],
        maximumRows: 1,
        requireExactIds: true,
      })
    ).toThrow("transaction persistence boundary")
  })

  it("verifies exact media mutation acknowledgements", () => {
    expect(
      readCatalogMediaAssetMutation([catalogMediaAssetFixture()], {
        alt_text: "Cover",
        id: "cmedia_1",
        version: 1,
      }).id
    ).toBe("cmedia_1")
    expect(() =>
      readCatalogMediaAssetMutation([catalogMediaAssetFixture()], {
        id: "cmedia_1",
        version: 2,
      })
    ).toThrow("transaction persistence boundary")
  })

  it("validates media ownership and exact relationship writes", () => {
    const item = catalogProductMediaItemFixture()
    expect(
      readCatalogProductMediaItems([item], { productId: "prod_1" })
    ).toEqual([expect.objectContaining({ id: "cpmedia_1" })])
    expect(
      readExactCatalogProductMediaItems([item], "prod_1", [
        {
          media_asset_id: "cmedia_1",
          product_id: "prod_1",
          role: "primary",
        },
      ])
    ).toHaveLength(1)
    expect(() =>
      readCatalogProductMediaItems([item], { productId: "prod_other" })
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readExactCatalogProductMediaItems([], "prod_1", [item])
    ).toThrow("transaction persistence boundary")
  })
})

describe("catalog authoring operation persistence contracts", () => {
  it("accepts pending, succeeded, compensated, and failed operation states", () => {
    expect(
      readCatalogTransactionOperationList([catalogOperationFixture()])
    ).toEqual(expect.objectContaining({ status: "pending" }))
    expect(
      readCatalogTransactionOperationList([
        catalogOperationFixture({
          result: { productId: "prod_1", version: 1 },
          status: "succeeded",
        }),
      ])
    ).toEqual(expect.objectContaining({ status: "succeeded" }))
    expect(
      readCatalogTransactionOperationList([
        catalogOperationFixture({ status: "compensated" }),
      ])
    ).toEqual(expect.objectContaining({ status: "compensated" }))
    expect(
      readCatalogTransactionOperationList([
        catalogOperationFixture({ status: "failed" }),
      ])
    ).toEqual(expect.objectContaining({ status: "failed" }))
  })

  it("rejects duplicated, malformed, or internally inconsistent operations", () => {
    expect(() =>
      readCatalogTransactionOperationList([
        catalogOperationFixture(),
        catalogOperationFixture({ id: "catop_2" }),
      ])
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogTransactionOperationList([
        catalogOperationFixture({ request_sha256: "bad" }),
      ])
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogTransactionOperationList([
        catalogOperationFixture({ completed_at: null, status: "succeeded" }),
      ])
    ).toThrow("transaction persistence boundary")
  })

  it("verifies exact operation identity, metadata, result, and status", () => {
    const operation = catalogOperationFixture()
    expect(
      readCatalogTransactionOperationMutation([operation], {
        actorId: "user_1",
        aggregateId: "prod_1",
        command: "catalog.product-media.replace",
        expectedVersion: 0,
        id: "catop_1",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        metadata: {},
        requestSha256: "a".repeat(64),
        result: {},
        status: "pending",
      }).id
    ).toBe("catop_1")
    expect(() =>
      readCatalogTransactionOperationMutation([operation], {
        actorId: "user_1",
        aggregateId: "prod_other",
        command: "catalog.product-media.replace",
        expectedVersion: 0,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        requestSha256: "a".repeat(64),
        status: "pending",
      })
    ).toThrow("transaction persistence boundary")
  })

  it("accepts only exact product-media and lifecycle results", () => {
    expect(
      readCatalogProductMediaOperationResult({
        productId: "prod_1",
        version: 2,
      })
    ).toEqual({ productId: "prod_1", version: 2 })
    expect(() =>
      readCatalogProductMediaOperationResult({
        extra: true,
        productId: "prod_1",
        version: 2,
      })
    ).toThrow("transaction persistence boundary")
    expect(
      readCatalogMediaLifecycleOperationResult({
        assetId: "cmedia_1",
        lifecycleStatus: "quarantined",
        purgeEligibleAt: "2026-09-29T00:00:00.000Z",
        quarantinedAt: "2026-08-30T00:00:00.000Z",
        version: 2,
      })
    ).toEqual(expect.objectContaining({ lifecycleStatus: "quarantined" }))
    expect(() =>
      readCatalogMediaLifecycleOperationResult({
        assetId: "cmedia_1",
        lifecycleStatus: "active",
        purgeEligibleAt: "2026-09-29T00:00:00.000Z",
        quarantinedAt: null,
        version: 2,
      })
    ).toThrow("transaction persistence boundary")
  })

  it("validates replayed upload files against the original request", () => {
    const result = {
      files: [
        {
          filename: "cover.jpg",
          id: "file_1",
          mediaAssetId: "cmedia_1",
          mimeType: "image/webp",
          size: 1_024,
          url: "https://media.example/cover.webp",
        },
      ],
    }
    expect(
      readCatalogMediaUploadOperationResult(result, [
        { filename: "cover.jpg", mimeType: "image/webp", size: 1_024 },
      ])
    ).toHaveLength(1)
    expect(() =>
      readCatalogMediaUploadOperationResult(result, [
        { filename: "other.jpg", mimeType: "image/webp", size: 1_024 },
      ])
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogMediaUploadOperationResult({
        files: [
          result.files[0],
          { ...result.files[0], mediaAssetId: "cmedia_2" },
        ],
      })
    ).toThrow("transaction persistence boundary")
  })
})

describe("catalog bundle persistence contracts", () => {
  it("accepts one product-owned bundle profile and rejects duplicates", () => {
    expect(readCatalogBundleStateProfiles([bundleProfile()], "prod_1")).toEqual(
      [bundleProfile()]
    )
    expect(() =>
      readCatalogBundleStateProfiles(
        [bundleProfile(), bundleProfile({ id: "cbundle_2" })],
        "prod_1"
      )
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogBundleStateProfiles([bundleProfile()], "prod_other")
    ).toThrow("transaction persistence boundary")
  })

  it("validates counted Admin pages and product filters", () => {
    expect(
      readCatalogBundleStatePage([[bundleProfile()], 4], {
        expectedProductId: "prod_1",
        maximumRows: 10,
      })
    ).toEqual({ count: 4, rows: [bundleProfile()] })
    expect(() =>
      readCatalogBundleStatePage([[bundleProfile()], 0], {
        maximumRows: 10,
      })
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readCatalogBundleStatePage([[bundleProfile()], 1], {
        expectedProductId: "prod_other",
        maximumRows: 10,
      })
    ).toThrow("transaction persistence boundary")
  })

  it("verifies profile and component mutation acknowledgements", () => {
    expect(
      readCatalogBundleProfileMutation([bundleProfile()], {
        id: "cbundle_1",
        version: 1,
      }).id
    ).toBe("cbundle_1")
    expect(
      readExactCatalogBundleComponents([bundleComponent()], "cbundle_1", [
        { component_product_id: "prod_2", quantity: 2 },
      ])
    ).toHaveLength(1)
    expect(() =>
      readExactCatalogBundleComponents([], "cbundle_1", [bundleComponent()])
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readExactCatalogBundleComponents(
        [bundleComponent({ bundle_profile_id: "cbundle_other" })],
        "cbundle_1",
        [bundleComponent()]
      )
    ).toThrow("transaction persistence boundary")
  })

  it("verifies exact inventory provenance ownership and quantities", () => {
    expect(
      readExactCatalogBundleInventoryLinks([inventoryLink()], "cbundle_1", [
        inventoryLink(),
      ])
    ).toHaveLength(1)
    expect(() =>
      readExactCatalogBundleInventoryLinks(
        [inventoryLink({ required_quantity: 1 })],
        "cbundle_1",
        [inventoryLink()]
      )
    ).toThrow("transaction persistence boundary")
    expect(() =>
      readExactCatalogBundleInventoryLinks(
        [inventoryLink(), inventoryLink({ id: "cbilink_2" })],
        "cbundle_1",
        [inventoryLink(), inventoryLink({ id: "cbilink_2" })]
      )
    ).toThrow("transaction persistence boundary")
  })

  it("compares complete snapshots and exact operation results", () => {
    const snapshot = {
      components: [bundleComponent()],
      profile: bundleProfile(),
    }
    expect(() =>
      assertExactCatalogBundleSnapshot(snapshot, snapshot)
    ).not.toThrow()
    expect(() =>
      assertExactCatalogBundleSnapshot(snapshot, {
        ...snapshot,
        components: [bundleComponent({ quantity: 3 })],
      })
    ).toThrow("transaction persistence boundary")
    expect(
      readCatalogBundleOperationResult({
        deleted: false,
        productId: "prod_1",
        profileId: "cbundle_1",
        version: 2,
      })
    ).toEqual({
      deleted: false,
      productId: "prod_1",
      profileId: "cbundle_1",
      version: 2,
    })
    expect(() =>
      readCatalogBundleOperationResult({
        deleted: true,
        productId: "prod_1",
        profileId: "cbundle_1",
        version: 2,
      })
    ).toThrow("transaction persistence boundary")
  })
})
