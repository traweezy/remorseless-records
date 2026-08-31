import {
  readAdminCatalogProductProfiles,
  readAdminCatalogShelfMutation,
  readAdminCatalogShelfPage,
  readAdminCatalogShelfProducts,
  readExactAdminCatalogShelfProducts,
  readShelfLifecycleOperationResult,
  readShelfOperationList,
  readShelfOperationMutation,
  readShelfUpsertOperationResult,
} from "./shelf-persistence-contracts"

const INVALID_SHELF =
  "The catalog shelf persistence boundary returned invalid structured data."
const idempotencyKey = "8bff4ab1-0d8b-4b73-a928-856272bfac81"
const requestSha256 = "a".repeat(64)

const shelf = (overrides: Record<string, unknown> = {}) => ({
  archived_at: null,
  automation_type: "none",
  created_at: "2026-08-01T00:00:00.000Z",
  description: "Featured records",
  ends_at: null,
  handle: "featured",
  id: "cshelf_1",
  is_active: true,
  metadata: {},
  mode: "manual",
  product_limit: 12,
  ribbon_label: "Featured",
  ribbon_priority: 20,
  show_ribbon: true,
  starts_at: null,
  title: "Featured",
  updated_at: "2026-08-02T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const membership = (overrides: Record<string, unknown> = {}) => ({
  created_at: "2026-08-01T00:00:00.000Z",
  ends_at: null,
  id: "cshelfp_1",
  is_pinned: false,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: null,
  shelf_id: "cshelf_1",
  sort_order: 0,
  starts_at: null,
  updated_at: "2026-08-02T00:00:00.000Z",
  ...overrides,
})

const operation = (overrides: Record<string, unknown> = {}) => ({
  actor_id: "user_1",
  aggregate_id: "cshelf_1",
  command: "catalog.shelf.upsert",
  completed_at: null,
  error_code: null,
  error_detail: null,
  expected_version: 1,
  id: "catop_1",
  idempotency_key: idempotencyKey,
  metadata: {},
  request_sha256: requestSha256,
  result: {},
  status: "pending",
  ...overrides,
})

describe("catalog shelf persistence contracts", () => {
  it("accepts complete counted pages and exact shelf mutations", () => {
    expect(readAdminCatalogShelfPage([[shelf()], 3], 100)).toMatchObject({
      count: 3,
      records: [{ handle: "featured", id: "cshelf_1" }],
    })
    expect(
      readAdminCatalogShelfMutation([shelf({ version: 2 })], {
        fields: { title: "Featured" },
        id: "cshelf_1",
        version: 2,
      }).version
    ).toBe(2)
    expect(() =>
      readAdminCatalogShelfMutation([shelf({ version: 2 })], {
        fields: { title: "Wrong acknowledgement" },
        id: "cshelf_1",
        version: 2,
      })
    ).toThrow(INVALID_SHELF)
  })

  it.each([
    ["a short count", [[shelf()], 0]],
    ["duplicate handles", [[shelf(), shelf({ id: "cshelf_2" })], 2]],
    [
      "an impossible schedule",
      [
        [
          shelf({
            ends_at: "2026-08-02T00:00:00.000Z",
            starts_at: "2026-08-03T00:00:00.000Z",
          }),
        ],
        1,
      ],
    ],
    ["an automatic shelf without a rule", [[shelf({ mode: "automatic" })], 1]],
    [
      "an active archived shelf",
      [[shelf({ archived_at: "2026-08-02T00:00:00.000Z" })], 1],
    ],
    ["a customer ribbon without text", [[shelf({ ribbon_label: null })], 1]],
  ])("rejects %s", (_label, value) => {
    expect(() => readAdminCatalogShelfPage(value, 100)).toThrow(INVALID_SHELF)
  })

  it("validates membership ownership, uniqueness, and exact persistence", () => {
    expect(
      readAdminCatalogShelfProducts([membership()], ["cshelf_1"])
    ).toMatchObject([{ product_id: "prod_1", shelf_id: "cshelf_1" }])
    expect(
      readExactAdminCatalogShelfProducts([membership()], "cshelf_1", [
        {
          ends_at: null,
          is_pinned: false,
          metadata: {},
          product_id: "prod_1",
          product_profile_id: null,
          sort_order: 0,
          starts_at: null,
        },
      ])
    ).toHaveLength(1)
  })

  it.each([
    ["a foreign shelf", [membership({ shelf_id: "cshelf_2" })]],
    [
      "duplicate Product membership",
      [membership(), membership({ id: "cshelfp_2" })],
    ],
    [
      "a malformed Product profile",
      [membership({ product_profile_id: "profile_1" })],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readAdminCatalogShelfProducts(value, ["cshelf_1"])).toThrow(
      INVALID_SHELF
    )
  })

  it("allows only requested Product profile projections", () => {
    expect(
      readAdminCatalogProductProfiles(
        [{ id: "cprof_1", product_id: "prod_1" }],
        ["cprof_1"]
      )
    ).toEqual([{ id: "cprof_1", product_id: "prod_1" }])
    expect(() =>
      readAdminCatalogProductProfiles(
        [{ id: "cprof_other", product_id: "prod_1" }],
        ["cprof_1"]
      )
    ).toThrow(INVALID_SHELF)
  })

  it("validates exact pending and succeeded operation acknowledgements", () => {
    const expected = {
      actorId: "user_1",
      aggregateId: "cshelf_1",
      command: "catalog.shelf.upsert",
      expectedVersion: 1,
      idempotencyKey,
      requestSha256,
      status: "pending" as const,
    }
    expect(readShelfOperationList([operation()])?.id).toBe("catop_1")
    expect(readShelfOperationMutation([operation()], expected).status).toBe(
      "pending"
    )
    expect(
      readShelfOperationMutation(
        [
          operation({
            completed_at: "2026-08-02T00:00:00.000Z",
            result: { created: false, shelfId: "cshelf_1", version: 2 },
            status: "succeeded",
          }),
        ],
        { ...expected, id: "catop_1", status: "succeeded" }
      ).status
    ).toBe("succeeded")
    expect(() =>
      readShelfOperationMutation(
        [
          operation({
            completed_at: "2026-08-02T00:00:00.000Z",
            id: "catop_other",
            result: { created: false, shelfId: "cshelf_1", version: 2 },
            status: "succeeded",
          }),
        ],
        { ...expected, id: "catop_1", status: "succeeded" }
      )
    ).toThrow(INVALID_SHELF)
  })

  it.each([
    ["duplicate operation rows", [operation(), operation({ id: "catop_2" })]],
    ["a malformed digest", [operation({ request_sha256: "invalid" })]],
    ["a nonempty pending result", [operation({ result: { version: 2 } })]],
    [
      "a completed pending row",
      [operation({ completed_at: "2026-08-02T00:00:00.000Z" })],
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => readShelfOperationList(value)).toThrow(INVALID_SHELF)
  })

  it("requires exact shelf command result keys and values", () => {
    expect(
      readShelfUpsertOperationResult({
        created: false,
        shelfId: "cshelf_1",
        version: 2,
      })
    ).toEqual({ created: false, shelfId: "cshelf_1", version: 2 })
    expect(
      readShelfLifecycleOperationResult({
        archived: true,
        shelfId: "cshelf_1",
        version: 2,
      })
    ).toEqual({ archived: true, shelfId: "cshelf_1", version: 2 })
    expect(() =>
      readShelfUpsertOperationResult({
        created: false,
        internal: true,
        shelfId: "cshelf_1",
        version: 2,
      })
    ).toThrow(INVALID_SHELF)
  })
})
