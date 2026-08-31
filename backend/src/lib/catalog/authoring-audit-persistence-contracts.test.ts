import { catalogProductProfileFixture } from "./transaction-persistence-fixtures.test-helpers"
import {
  assertCatalogAuthoringAuditRelationships,
  CATALOG_AUTHORING_AUDIT_MAXIMUM_RECORDS,
  loadAllCatalogAuthoringAuditRecords,
  readCatalogAuthoringAuditBundlePage,
  readCatalogAuthoringAuditProductPage,
  readCatalogAuthoringAuditProfilePage,
  readCatalogAuthoringAuditReferencePage,
  readCatalogAuthoringAuditService,
  type CatalogAuthoringAuditProductPersistenceRecord,
} from "./authoring-audit-persistence-contracts"

const product = (overrides: Record<string, unknown> = {}) => ({
  handle: "release",
  id: "prod_1",
  metadata: {},
  status: "published",
  title: "Release",
  type: { value: "Music release" },
  ...overrides,
})

const reference = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-30T00:00:00.000Z",
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "product_type",
  label: "Music release",
  metadata: {},
  rank: 0,
  updated_at: "2026-08-30T00:00:00.000Z",
  value: "music-release",
  ...overrides,
})

const bundle = (overrides: Record<string, unknown> = {}) => ({
  bundle_type: "fixed",
  created_at: "2026-08-30T00:00:00.000Z",
  description_html: null,
  display_title: "Release bundle",
  fulfillment_mode: "ship_components",
  id: "cbundle_1",
  inventory_mode: "component_derived",
  is_active: true,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  updated_at: "2026-08-30T00:00:00.000Z",
  version: 1,
  ...overrides,
})

describe("catalog authoring audit persistence contracts", () => {
  it("requires every service method before starting the audit", () => {
    expect(
      readCatalogAuthoringAuditService<{ list: () => void }>(
        { list: () => undefined },
        ["list"]
      )
    ).toMatchObject({ list: expect.any(Function) })
    expect(() =>
      readCatalogAuthoringAuditService({}, ["listAndCountProducts"])
    ).toThrow("authoring audit persistence boundary")
  })

  it("accepts complete bounded Product, profile, reference, and bundle pages", () => {
    expect(readCatalogAuthoringAuditProductPage([[product()], 1], 250)).toEqual(
      {
        count: 1,
        records: [product()],
      }
    )
    expect(
      readCatalogAuthoringAuditProfilePage(
        [[catalogProductProfileFixture({ product_type_id: "cref_1" })], 1],
        250
      )
    ).toMatchObject({ count: 1, records: [{ id: "cprof_1" }] })
    expect(
      readCatalogAuthoringAuditReferencePage([[reference()], 1], 250)
    ).toMatchObject({ count: 1, records: [{ id: "cref_1" }] })
    expect(
      readCatalogAuthoringAuditBundlePage([[bundle()], 1], 250)
    ).toMatchObject({ count: 1, records: [{ id: "cbundle_1" }] })
  })

  it.each<[unknown[], number]>([
    [[null], 1],
    [[product({ id: "wrong_1" })], 1],
    [[product({ status: "invented" })], 1],
    [[product({ title: "Release\nforged-log" })], 1],
    [[product({ type: { value: null } })], 1],
    [[product({ metadata: { constructor: "unsafe" } })], 1],
    [[product(), product()], 2],
  ])("rejects malformed or duplicate Product pages %#", (records, count) => {
    expect(() =>
      readCatalogAuthoringAuditProductPage([records, count], 250)
    ).toThrow("authoring audit persistence boundary")
  })

  it("rejects unexpected reference kinds and oversized declared totals", () => {
    expect(() =>
      readCatalogAuthoringAuditReferencePage(
        [[reference({ kind: "genre" })], 1],
        250
      )
    ).toThrow("authoring audit persistence boundary")
    expect(() =>
      readCatalogAuthoringAuditProductPage(
        [[], CATALOG_AUTHORING_AUDIT_MAXIMUM_RECORDS + 1],
        250
      )
    ).toThrow("authoring audit persistence boundary")
  })

  it("loads exact stable pages in order", async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) =>
      product({
        handle: `release-${index}`,
        id: `prod_${index.toString().padStart(3, "0")}`,
        title: `Release ${index}`,
      })
    )
    const pages = [
      [firstPage, 251],
      [[product({ handle: "shirt", id: "prod_251", title: "Shirt" })], 251],
    ]
    const listPage = jest.fn(async () => pages.shift())

    await expect(
      loadAllCatalogAuthoringAuditRecords<CatalogAuthoringAuditProductPersistenceRecord>(
        {
          identity: ({ id }) => id,
          listPage,
          readPage: readCatalogAuthoringAuditProductPage,
        }
      )
    ).resolves.toHaveLength(251)
    expect(listPage).toHaveBeenNthCalledWith(1, 0, 250)
    expect(listPage).toHaveBeenNthCalledWith(2, 250, 250)
  })

  it.each<[string, Array<[unknown[], number]>]>([
    [
      "short page",
      [
        [[product()], 2],
        [[], 2],
      ],
    ],
    [
      "count drift",
      [
        [[product()], 2],
        [[product({ handle: "shirt", id: "prod_2", title: "Shirt" })], 3],
      ],
    ],
    [
      "cross-page duplicate",
      [
        [[product()], 2],
        [[product()], 2],
      ],
    ],
  ])("rejects %s pagination", async (_label, pages) => {
    const remaining = [...pages]
    await expect(
      loadAllCatalogAuthoringAuditRecords<CatalogAuthoringAuditProductPersistenceRecord>(
        {
          identity: ({ id }) => id,
          listPage: async () => remaining.shift(),
          readPage: (value) => readCatalogAuthoringAuditProductPage(value, 1),
        }
      )
    ).rejects.toThrow("authoring audit persistence boundary")
  })

  it("requires bundle and profile ownership to resolve to the audited Products", () => {
    const products = readCatalogAuthoringAuditProductPage(
      [[product()], 1],
      250
    ).records
    const profiles = readCatalogAuthoringAuditProfilePage(
      [[catalogProductProfileFixture()], 1],
      250
    ).records
    const references = readCatalogAuthoringAuditReferencePage(
      [[reference()], 1],
      250
    ).records
    const bundles = readCatalogAuthoringAuditBundlePage(
      [[bundle()], 1],
      250
    ).records

    expect(() =>
      assertCatalogAuthoringAuditRelationships({
        bundles,
        products,
        profiles,
        references,
      })
    ).not.toThrow()
    expect(() =>
      assertCatalogAuthoringAuditRelationships({
        bundles: bundles.map((entry) => ({
          ...entry,
          product_id: "prod_missing",
        })),
        products,
        profiles,
        references,
      })
    ).toThrow("authoring audit persistence boundary")
  })
})
