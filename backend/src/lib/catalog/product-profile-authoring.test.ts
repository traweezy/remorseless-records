import type { CatalogProductProfileRecord } from "../../modules/catalog/serializers"
import {
  catalogProductProfileUpsertSchema,
  compensateCatalogProductProfileMutation,
  mutateCatalogProductProfile,
} from "./product-profile-authoring"
import type { CatalogService } from "./reference-resolution"

type ServiceMock = jest.Mocked<CatalogService>

const serviceFixture = (): ServiceMock => {
  let operation: Record<string, unknown> | null = null
  let artists: Record<string, unknown>[] = []
  let references: Record<string, unknown>[] = []
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
  service.createCatalogAuthoringOperations.mockImplementation(
    async (payloads) =>
      payloads.map((payload) => {
        operation = {
          ...payload,
          completed_at: null,
          error_code: null,
          error_detail: null,
          id: "catop_1",
        }
        return operation
      }) as never
  )
  service.updateCatalogAuthoringOperations.mockImplementation(
    async (payloads) =>
      (payloads as Record<string, unknown>[]).map((payload) => {
        operation = { ...operation, ...payload }
        return operation
      }) as never
  )
  service.createCatalogProductArtists.mockImplementation(async (payloads) => {
    artists = payloads.map((payload, index) => ({
      ...payload,
      id: typeof payload.id === "string" ? payload.id : `cpart_${index + 1}`,
    }))
    return artists as never
  })
  service.deleteCatalogProductArtists.mockImplementation(async () => {
    artists = []
  })
  service.listCatalogProductArtists.mockImplementation(
    async () => artists as never
  )
  service.createCatalogProductReferences.mockImplementation(
    async (payloads) => {
      references = payloads.map((payload, index) => ({
        ...payload,
        id: typeof payload.id === "string" ? payload.id : `cpref_${index + 1}`,
      }))
      return references as never
    }
  )
  service.deleteCatalogProductReferences.mockImplementation(async () => {
    references = []
  })
  service.listCatalogProductReferences.mockImplementation(
    async () => references as never
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogProductProfiles.mockResolvedValue([])
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
  requestSha256: "a".repeat(64),
}

const operation = (overrides: Record<string, unknown> = {}) => ({
  actor_id: command.actorId,
  aggregate_id: command.aggregateId,
  command: command.command,
  completed_at: null,
  error_code: null,
  error_detail: null,
  expected_version: command.expectedVersion,
  id: "catop_1",
  idempotency_key: command.idempotencyKey,
  metadata: {},
  request_sha256: command.requestSha256,
  result: {},
  status: "pending",
  ...overrides,
})

const artist = (overrides: Record<string, unknown> = {}) => ({
  bio: null,
  id: "artist_1",
  image_url: null,
  location: null,
  metadata: {},
  name: "Artist",
  slug: "artist",
  sort_name: "Artist",
  ...overrides,
})

const reference = (overrides: Record<string, unknown> = {}) => ({
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "genre",
  label: "Metal",
  metadata: {},
  rank: 0,
  value: "metal",
  ...overrides,
})

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
      operation(),
    ] as never)
    service.createCatalogProductProfiles.mockResolvedValue([
      profile({ release_title: "Album" }),
    ] as never)

    await expect(
      mutateCatalogProductProfile(service, command)
    ).resolves.toMatchObject({
      created: true,
      operationId: "catop_1",
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
    expect(service.listCatalogAuthoringOperations).toHaveBeenCalledWith(
      { idempotency_key: command.idempotencyKey },
      { take: 2 },
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

  it("rejects a mismatched pending audit acknowledgement before writing", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operation({ request_sha256: "b".repeat(64) }),
    ] as never)

    await expect(mutateCatalogProductProfile(service, command)).rejects.toThrow(
      "The catalog profile persistence boundary returned invalid structured data."
    )
    expect(service.createCatalogProductProfiles).not.toHaveBeenCalled()
  })

  it("rejects a Product profile write that does not echo the command", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operation(),
    ] as never)
    service.createCatalogProductProfiles.mockResolvedValue([
      profile({ release_title: "Different title" }),
    ] as never)

    await expect(mutateCatalogProductProfile(service, command)).rejects.toThrow(
      "The catalog profile persistence boundary returned invalid structured data."
    )
  })

  it("replays only the exact completed command", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operation({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          productId: "prod_1",
          profileId: "cprof_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ] as never)
    service.listCatalogProductProfiles.mockResolvedValue([profile()] as never)

    await expect(
      mutateCatalogProductProfile(service, command)
    ).resolves.toMatchObject({
      operationId: "catop_1",
      profileId: "cprof_1",
      replayed: true,
      version: 1,
    })
    expect(service.createCatalogProductProfiles).not.toHaveBeenCalled()

    await expect(
      mutateCatalogProductProfile(service, {
        ...command,
        requestSha256: "b".repeat(64),
      })
    ).rejects.toThrow("cannot be replayed")
  })

  it("rejects replay when the retained profile no longer matches the result", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operation({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          productId: "prod_1",
          profileId: "cprof_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ] as never)
    service.listCatalogProductProfiles.mockResolvedValue([
      profile({ version: 2 }),
    ] as never)

    await expect(mutateCatalogProductProfile(service, command)).rejects.toThrow(
      "no longer has its exact response"
    )
  })

  it("tracks newly created artists and references for compensation", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operation(),
    ] as never)
    service.createCatalogProductProfiles.mockResolvedValue([
      profile({ label_id: "cref_label" }),
    ] as never)
    service.createCatalogArtists.mockResolvedValue([
      artist({ id: "artist_new" }),
    ] as never)
    service.createCatalogReferenceValues
      .mockResolvedValueOnce([
        reference({
          id: "cref_label",
          kind: "label",
          label: "Label",
          value: "label",
        }),
      ] as never)
      .mockResolvedValueOnce([reference({ id: "cref_genre" })] as never)

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
      createdReferenceValueIds: ["cref_label", "cref_genre"],
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
  it("refuses to compensate an operation that is no longer pending", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operation({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          productId: "prod_1",
          profileId: "cprof_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ] as never)

    await expect(
      compensateCatalogProductProfileMutation(service, {
        aggregateId: "prod_1",
        createdArtistIds: [],
        createdReferenceValueIds: [],
        operationId: "catop_1",
        previous: { artists: [], profile: null, references: [] },
      })
    ).rejects.toThrow("compensation operation could not be verified")
    expect(service.deleteCatalogProductProfiles).not.toHaveBeenCalled()
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

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
      reference_value_id: "cref_existing",
      sort_order: 0,
    }
    service.listCatalogProductProfiles.mockImplementation(
      async (filters: Record<string, unknown>) =>
        "product_id" in filters ? ([profile({ version: 4 })] as never) : []
    )
    service.listCatalogProductArtists
      .mockResolvedValueOnce([
        {
          ...previousArtist,
          id: "cpart_current",
        },
      ] as never)
      .mockResolvedValueOnce([])
    service.listCatalogProductReferences
      .mockResolvedValueOnce([
        {
          ...previousReference,
          id: "cpref_current",
        },
      ] as never)
      .mockResolvedValue([])
    service.listCatalogVariantProfiles.mockResolvedValue([])
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operation(),
    ] as never)
    service.updateCatalogProductProfiles.mockResolvedValue([
      previousProfile,
    ] as never)
    service.updateCatalogAuthoringOperations.mockResolvedValue([
      operation({
        completed_at: "2026-08-02T00:00:00.000Z",
        error_code: "workflow_compensated",
        error_detail:
          "A later workflow step failed; the previous product profile state was restored.",
        status: "compensated",
      }),
    ] as never)

    await compensateCatalogProductProfileMutation(service, {
      aggregateId: "prod_1",
      createdArtistIds: ["artist_new"],
      createdReferenceValueIds: ["cref_new"],
      operationId: "catop_1",
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
      "cref_new",
      expect.anything()
    )
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "catop_1",
          status: "compensated",
        }),
      ],
      expect.anything()
    )
  })
})
