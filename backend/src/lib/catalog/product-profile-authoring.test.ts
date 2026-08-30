import type CatalogModuleService from "../../modules/catalog/service"
import type { CatalogProductProfileRecord } from "../../modules/catalog/serializers"
import {
  catalogProductProfileUpsertSchema,
  compensateCatalogProductProfileMutation,
  mutateCatalogProductProfile,
} from "./product-profile-authoring"
import type { CatalogService } from "./reference-resolution"

type ServiceMock = jest.Mocked<CatalogService>

const serviceFixture = (): ServiceMock => {
  const service = {
    createCatalogArtists: jest.fn(),
    createCatalogAuthoringOperations: jest.fn(),
    createCatalogProductArtists: jest.fn(),
    createCatalogProductProfiles: jest.fn(),
    createCatalogProductReferences: jest.fn(),
    createCatalogReferenceValues: jest.fn(),
    deleteCatalogArtists: jest.fn(),
    deleteCatalogProductArtists: jest.fn(),
    deleteCatalogProductProfiles: jest.fn(),
    deleteCatalogProductReferences: jest.fn(),
    deleteCatalogReferenceValues: jest.fn(),
    listCatalogArtists: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    listCatalogProductArtists: jest.fn(),
    listCatalogProductProfiles: jest.fn(),
    listCatalogProductReferences: jest.fn(),
    listCatalogReferenceValues: jest.fn(),
    listCatalogVariantProfiles: jest.fn(),
    retrieveCatalogArtist: jest.fn(),
    retrieveCatalogReferenceValue: jest.fn(),
    runCatalogTransaction: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
    updateCatalogProductProfiles: jest.fn(),
  } as unknown as ServiceMock

  service.runCatalogTransaction.mockImplementation((async (task) =>
    task({ manager: {} } as never)) as CatalogService["runCatalogTransaction"])
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogProductProfiles.mockResolvedValue([])
  service.listCatalogProductArtists.mockResolvedValue([])
  service.listCatalogProductReferences.mockResolvedValue([])
  service.listCatalogVariantProfiles.mockResolvedValue([])
  service.listCatalogArtists.mockResolvedValue([])
  service.listCatalogReferenceValues.mockResolvedValue([])
  return service
}

const profile = (
  overrides: Partial<CatalogProductProfileRecord> = {}
): CatalogProductProfileRecord => ({
  content_schema_version: 1,
  credits: {},
  description_html: null,
  id: "cprof_1",
  label_id: null,
  merch_details: {},
  metadata: {},
  pressing_notes: {},
  product_id: "prod_1",
  product_type_id: null,
  release_date: null,
  release_date_precision: "unknown",
  release_title: null,
  release_year: null,
  search_keywords: [],
  tracklist: [],
  version: 1,
  ...overrides,
})

const command = {
  actorId: "user_1",
  aggregateId: "prod_1",
  command: "catalog.product-profile.upsert" as const,
  expectedVersion: 0,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  patch: {
    releaseTitle: "Album",
  },
  requestSha256: "request_hash",
}

describe("catalogProductProfileUpsertSchema", () => {
  it("accepts the compatibility payload and bounds collection sizes", () => {
    expect(
      catalogProductProfileUpsertSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: command.idempotencyKey,
        releaseTitle: "Album",
        artists: [{ name: "Artist", sortOrder: 0 }],
      }).success
    ).toBe(true)
    expect(
      catalogProductProfileUpsertSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: command.idempotencyKey,
        references: Array.from({ length: 101 }, () => ({
          kind: "genre",
          label: "Metal",
        })),
      }).success
    ).toBe(false)
    expect(
      catalogProductProfileUpsertSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: command.idempotencyKey,
        releaseDate: "not-a-date",
      }).success
    ).toBe(false)
  })
})

describe("mutateCatalogProductProfile", () => {
  it("creates a pending, versioned command without completing it early", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "operation_1" },
    ] as never)
    service.createCatalogProductProfiles.mockResolvedValue([
      profile({ release_title: "Album" }),
    ] as never)

    await expect(
      mutateCatalogProductProfile(service, command)
    ).resolves.toMatchObject({
      created: true,
      operationId: "operation_1",
      previous: { artists: [], profile: null, references: [] },
      productId: "prod_1",
      profileId: "cprof_1",
      replayed: false,
      version: 1,
    })
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          aggregate_id: "prod_1",
          expected_version: 0,
          idempotency_key: command.idempotencyKey,
          status: "pending",
        }),
      ],
      expect.anything()
    )
    expect(service.createCatalogProductProfiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          product_id: "prod_1",
          release_title: "Album",
          version: 1,
        }),
      ],
      expect.anything()
    )
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects stale edits before creating an audit operation", async () => {
    const service = serviceFixture()
    service.listCatalogProductProfiles.mockResolvedValue([profile()] as never)

    await expect(mutateCatalogProductProfile(service, command)).rejects.toThrow(
      "changed after it was loaded"
    )
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("replays only the exact completed command", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        aggregate_id: "prod_1",
        command: "catalog.product-profile.upsert",
        expected_version: 0,
        id: "operation_1",
        request_sha256: "request_hash",
        result: { profileId: "cprof_1", version: 1 },
        status: "succeeded",
      },
    ] as never)

    await expect(
      mutateCatalogProductProfile(service, command)
    ).resolves.toMatchObject({
      operationId: "operation_1",
      profileId: "cprof_1",
      replayed: true,
      version: 1,
    })
    expect(service.createCatalogProductProfiles).not.toHaveBeenCalled()

    await expect(
      mutateCatalogProductProfile(service, {
        ...command,
        requestSha256: "different_hash",
      })
    ).rejects.toThrow("cannot be replayed")
  })

  it("tracks newly created artists and references for compensation", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "operation_1" },
    ] as never)
    service.createCatalogProductProfiles.mockResolvedValue([profile()] as never)
    service.createCatalogArtists.mockResolvedValue([
      { id: "artist_new", name: "Artist", slug: "artist" },
    ] as never)
    service.createCatalogReferenceValues
      .mockResolvedValueOnce([
        {
          id: "ref_label",
          kind: "label",
          label: "Label",
          value: "label",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "ref_genre",
          kind: "genre",
          label: "Metal",
          value: "metal",
        },
      ] as never)

    await expect(
      mutateCatalogProductProfile(service, {
        ...command,
        patch: {
          artists: [{ name: "Artist" }],
          label: { label: "Label" },
          references: [{ kind: "genre", label: "Metal" }],
        },
      })
    ).resolves.toMatchObject({
      createdArtistIds: ["artist_new"],
      createdReferenceValueIds: ["ref_label", "ref_genre"],
    })
    expect(service.createCatalogProductArtists).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          artist_id: "artist_new",
          display_name: "Artist",
          product_profile_id: "cprof_1",
        }),
      ],
      expect.anything()
    )
  })
})

describe("compensateCatalogProductProfileMutation", () => {
  it("restores the complete prior aggregate and removes owned orphans", async () => {
    const service = serviceFixture()
    const previousProfile = profile({ release_title: "Before", version: 3 })
    const previousArtist = {
      artist_id: "artist_existing",
      display_name: "Existing",
      id: "cpart_1",
      metadata: {},
      product_profile_id: "cprof_1",
      role: "primary",
      sort_order: 0,
    }
    const previousReference = {
      id: "cpref_1",
      kind: "genre" as const,
      metadata: {},
      product_profile_id: "cprof_1",
      reference_value_id: "ref_existing",
      sort_order: 0,
    }
    service.listCatalogProductProfiles.mockImplementation(
      async (filters: Record<string, unknown>) =>
        "product_id" in filters ? ([profile({ version: 4 })] as never) : []
    )
    service.listCatalogProductArtists
      .mockResolvedValueOnce([{ id: "current_artist_assignment" }] as never)
      .mockResolvedValueOnce([])
    service.listCatalogProductReferences
      .mockResolvedValueOnce([{ id: "current_reference_assignment" }] as never)
      .mockResolvedValue([])
    service.listCatalogVariantProfiles.mockResolvedValue([])

    await compensateCatalogProductProfileMutation(service, {
      aggregateId: "prod_1",
      createdArtistIds: ["artist_new"],
      createdReferenceValueIds: ["ref_new"],
      operationId: "operation_1",
      previous: {
        artists: [previousArtist],
        profile: {
          content_schema_version: 1,
          credits: {},
          description_html: null,
          id: previousProfile.id,
          label_id: null,
          merch_details: {},
          metadata: {},
          pressing_notes: {},
          product_id: previousProfile.product_id,
          product_type_id: null,
          release_date: null,
          release_date_precision: "unknown",
          release_title: "Before",
          release_year: null,
          search_keywords: [],
          tracklist: [],
          version: 3,
        },
        references: [previousReference],
      },
    })

    expect(service.updateCatalogProductProfiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "cprof_1",
          release_title: "Before",
          version: 3,
        }),
      ],
      expect.anything()
    )
    expect(service.createCatalogProductArtists).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "cpart_1" })],
      expect.anything()
    )
    expect(service.deleteCatalogArtists).toHaveBeenCalledWith(
      "artist_new",
      expect.anything()
    )
    expect(service.deleteCatalogReferenceValues).toHaveBeenCalledWith(
      "ref_new",
      expect.anything()
    )
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "operation_1",
          status: "compensated",
        }),
      ],
      expect.anything()
    )
  })
})
