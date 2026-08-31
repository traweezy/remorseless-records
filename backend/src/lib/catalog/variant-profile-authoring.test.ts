import {
  catalogVariantProfileUpsertSchema,
  compensateCatalogVariantProfileMutation,
  mutateCatalogVariantProfile,
  type CatalogVariantProfileMutationInput,
  type CatalogVariantProfileState,
} from "./variant-profile-authoring"

const serviceFixture = () => {
  let operation: Record<string, unknown> | null = null
  const service = {
    createCatalogAuthoringOperations: jest.fn(),
    createCatalogReferenceValues: jest.fn(),
    createCatalogVariantProfiles: jest.fn(),
    deleteCatalogReferenceValues: jest.fn(),
    deleteCatalogVariantProfiles: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    listCatalogProductProfiles: jest.fn(),
    listCatalogProductReferences: jest.fn(),
    listCatalogReferenceValues: jest.fn(),
    listCatalogVariantProfiles: jest.fn(),
    retrieveCatalogProductProfile: jest.fn(),
    retrieveCatalogReferenceValue: jest.fn(),
    runCatalogTransaction: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
    updateCatalogVariantProfiles: jest.fn(),
  }
  service.runCatalogTransaction.mockImplementation(
    async (callback: (context: Record<string, unknown>) => unknown) =>
      callback({ transactionManager: {} })
  )
  service.createCatalogAuthoringOperations.mockImplementation(
    async (payloads: Record<string, unknown>[]) =>
      payloads.map((payload) => {
        operation = {
          ...payload,
          completed_at: null,
          error_code: null,
          error_detail: null,
          id: "catop_1",
        }
        return operation
      })
  )
  service.updateCatalogAuthoringOperations.mockImplementation(
    async (payloads: Record<string, unknown>[]) =>
      payloads.map((payload) => {
        operation = { ...operation, ...payload }
        return operation
      })
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.listCatalogProductProfiles.mockResolvedValue([])
  service.listCatalogProductReferences.mockResolvedValue([])
  service.listCatalogReferenceValues.mockResolvedValue([])
  service.listCatalogVariantProfiles.mockResolvedValue([])
  return service
}

const commandFixture = (
  patch: CatalogVariantProfileMutationInput["patch"] = {}
): CatalogVariantProfileMutationInput => ({
  actorId: "user_1",
  aggregateId: "variant_1",
  command: "catalog.variant-profile.upsert",
  expectedVersion: 0,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  patch,
  requestSha256: "a".repeat(64),
})

const operationFixture = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
  const command = commandFixture()
  return {
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
  }
}

const referenceFixture = (overrides: Record<string, unknown> = {}) => ({
  description: null,
  id: "cref_1",
  is_active: true,
  kind: "format",
  label: "LP",
  metadata: {},
  rank: 0,
  value: "lp",
  ...overrides,
})

const variantProfileFixture = (overrides: Record<string, unknown> = {}) => ({
  availability_status: "available",
  backorder_allowed: false,
  backorder_note: null,
  display_label: null,
  format_detail_id: null,
  format_detail_label: null,
  format_id: null,
  format_label: null,
  id: "cvprof_1",
  image_url: null,
  metadata: {},
  preorder_allowed: false,
  preorder_release_date: null,
  product_profile_id: null,
  variant_id: "variant_1",
  version: 1,
  ...overrides,
})

const previousProfileFixture = (): CatalogVariantProfileState => ({
  availability_status: "low_stock",
  backorder_allowed: false,
  backorder_note: null,
  display_label: "LP",
  format_detail_id: null,
  format_detail_label: null,
  format_id: "cref_old",
  format_label: "LP",
  id: "cvprof_1",
  image_url: null,
  metadata: { source: "before" },
  preorder_allowed: false,
  preorder_release_date: null,
  product_profile_id: "cprof_1",
  variant_id: "variant_1",
  version: 2,
})

describe("catalog variant profile authoring", () => {
  it("enforces bounded text, valid dates, and valid URLs", () => {
    const base = {
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    }
    expect(
      catalogVariantProfileUpsertSchema.safeParse({
        ...base,
        displayLabel: "x".repeat(501),
      }).success
    ).toBe(false)
    expect(
      catalogVariantProfileUpsertSchema.safeParse({
        ...base,
        preorderReleaseDate: "not-a-date",
      }).success
    ).toBe(false)
    expect(
      catalogVariantProfileUpsertSchema.safeParse({
        ...base,
        imageUrl: "javascript:alert(1)",
      }).success
    ).toBe(false)
  })

  it("creates a pending operation and tracks a newly created format", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operationFixture(),
    ])
    service.createCatalogReferenceValues.mockResolvedValue([
      referenceFixture({ id: "cref_lp" }),
    ])
    service.createCatalogVariantProfiles.mockResolvedValue([
      variantProfileFixture({ display_label: "LP", format_id: "cref_lp" }),
    ])

    const result = await mutateCatalogVariantProfile(
      service as never,
      commandFixture({
        displayLabel: "LP",
        format: { label: "LP" },
      })
    )

    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        createdReferenceValueIds: ["cref_lp"],
        operationId: "catop_1",
        profileId: "cvprof_1",
        replayed: false,
        variantId: "variant_1",
        version: 1,
      })
    )
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          aggregate_id: "variant_1",
          command: "catalog.variant-profile.upsert",
          expected_version: 0,
          idempotency_key: commandFixture().idempotencyKey,
          status: "pending",
        }),
      ],
      expect.any(Object)
    )
    expect(service.listCatalogAuthoringOperations).toHaveBeenCalledWith(
      { idempotency_key: commandFixture().idempotencyKey },
      { take: 2 },
      expect.any(Object)
    )
    expect(service.createCatalogVariantProfiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          display_label: "LP",
          format_id: "cref_lp",
          variant_id: "variant_1",
          version: 1,
        }),
      ],
      expect.any(Object)
    )
    expect(
      service.createCatalogVariantProfiles.mock.calls[0]?.[0]?.[0]
    ).not.toHaveProperty("availability_status")
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects a stale expected version before creating an operation", async () => {
    const service = serviceFixture()
    service.listCatalogVariantProfiles.mockResolvedValue([
      previousProfileFixture(),
    ])

    await expect(
      mutateCatalogVariantProfile(
        service as never,
        commandFixture({ displayLabel: "CD" })
      )
    ).rejects.toThrow("changed after it was loaded")
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("rejects a mismatched pending audit acknowledgement before writing", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operationFixture({ request_sha256: "b".repeat(64) }),
    ])

    await expect(
      mutateCatalogVariantProfile(service as never, commandFixture())
    ).rejects.toThrow(
      "The catalog profile persistence boundary returned invalid structured data."
    )
    expect(service.createCatalogVariantProfiles).not.toHaveBeenCalled()
  })

  it("rejects a Variant profile write that does not echo the command", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      operationFixture(),
    ])
    service.createCatalogVariantProfiles.mockResolvedValue([
      variantProfileFixture({ display_label: "Different label" }),
    ])

    await expect(
      mutateCatalogVariantProfile(
        service as never,
        commandFixture({ displayLabel: "LP" })
      )
    ).rejects.toThrow(
      "The catalog profile persistence boundary returned invalid structured data."
    )
  })

  it("replays only the exact succeeded command", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operationFixture({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          profileId: "cvprof_1",
          variantId: "variant_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ])
    service.listCatalogVariantProfiles.mockResolvedValue([
      variantProfileFixture(),
    ])

    await expect(
      mutateCatalogVariantProfile(service as never, command)
    ).resolves.toEqual(
      expect.objectContaining({
        profileId: "cvprof_1",
        replayed: true,
        version: 1,
      })
    )
    await expect(
      mutateCatalogVariantProfile(service as never, {
        ...command,
        requestSha256: "b".repeat(64),
      })
    ).rejects.toThrow("cannot be replayed")
    expect(service.createCatalogVariantProfiles).not.toHaveBeenCalled()
  })

  it("rejects replay when the retained profile no longer matches the result", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operationFixture({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          profileId: "cvprof_1",
          variantId: "variant_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ])
    service.listCatalogVariantProfiles.mockResolvedValue([
      variantProfileFixture({ version: 2 }),
    ])

    await expect(
      mutateCatalogVariantProfile(service as never, commandFixture())
    ).rejects.toThrow("no longer has its exact response")
  })

  it("refuses to compensate an operation that is no longer pending", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operationFixture({
        completed_at: "2026-08-02T00:00:00.000Z",
        result: {
          created: true,
          profileId: "cvprof_1",
          variantId: "variant_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ])

    await expect(
      compensateCatalogVariantProfileMutation(service as never, {
        aggregateId: "variant_1",
        createdReferenceValueIds: [],
        operationId: "catop_1",
        previous: { profile: null },
      })
    ).rejects.toThrow("compensation operation could not be verified")
    expect(service.deleteCatalogVariantProfiles).not.toHaveBeenCalled()
    expect(service.updateCatalogAuthoringOperations).not.toHaveBeenCalled()
  })

  it("restores complete prior state and removes owned orphan references", async () => {
    const service = serviceFixture()
    const previous = previousProfileFixture()
    service.listCatalogVariantProfiles
      .mockResolvedValueOnce([
        {
          ...previous,
          availability_status: "available",
          display_label: "Changed",
          format_id: "cref_new",
          version: 3,
        },
      ])
      .mockResolvedValue([])
    service.listCatalogAuthoringOperations.mockResolvedValue([
      operationFixture(),
    ])
    service.updateCatalogVariantProfiles.mockResolvedValue([previous])
    service.updateCatalogAuthoringOperations.mockResolvedValue([
      operationFixture({
        completed_at: "2026-08-02T00:00:00.000Z",
        error_code: "workflow_compensated",
        error_detail:
          "A later workflow step failed; the previous variant profile state was restored.",
        status: "compensated",
      }),
    ])

    await compensateCatalogVariantProfileMutation(service as never, {
      aggregateId: "variant_1",
      createdReferenceValueIds: ["cref_new"],
      operationId: "catop_1",
      previous: { profile: previous },
    })

    expect(service.updateCatalogVariantProfiles).toHaveBeenCalledWith(
      [previous],
      expect.any(Object)
    )
    expect(service.deleteCatalogReferenceValues).toHaveBeenCalledWith(
      "cref_new",
      expect.any(Object)
    )
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "catop_1",
          status: "compensated",
        }),
      ],
      expect.any(Object)
    )
  })
})
