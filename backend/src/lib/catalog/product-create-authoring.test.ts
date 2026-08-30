import type { CatalogVariantProfileMutationResult } from "./variant-profile-contract"
import type { CatalogService } from "./reference-resolution"
import { catalogProductCreateSchema } from "./product-create-contract"
import {
  beginCatalogProductCreation,
  buildCatalogVariantProfileMutation,
  completeCatalogProductCreation,
  compensateCatalogProductCreation,
  compensateCatalogProductVariantProfiles,
  inspectCatalogProductCreation,
  mutateCatalogProductVariantProfiles,
  type CatalogProductCreateCommandInput,
} from "./product-create-authoring"

type ServiceMock = jest.Mocked<CatalogService>

const serviceFixture = (): ServiceMock => {
  const service = {
    completeCatalogAuthoringOperation: jest.fn(),
    createCatalogAuthoringOperations: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    runCatalogTransaction: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
  } as unknown as ServiceMock
  service.runCatalogTransaction.mockImplementation(
    (async (task) =>
      task({ manager: {} } as never)) as CatalogService["runCatalogTransaction"],
  )
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  return service
}

const commandFixture = (): CatalogProductCreateCommandInput => ({
  ...catalogProductCreateSchema.parse({
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    kind: "music_release",
    title: "A New Record",
    options: [{ title: "Format", values: ["CD", "LP"] }],
    variants: [
      {
        key: "cd",
        title: "CD",
        options: { Format: "CD" },
        prices: [{ amount: 12, currencyCode: "usd" }],
        sku: "RECORD-CD",
        stockQuantity: 5,
        profile: { format: { label: "CD" } },
      },
      {
        key: "lp",
        title: "LP",
        options: { Format: "LP" },
        prices: [{ amount: 24, currencyCode: "usd" }],
        sku: "RECORD-LP",
        stockQuantity: 0,
        allowBackorder: true,
        profile: { format: { label: "LP" } },
      },
    ],
    profile: { artists: [{ name: "The Artist", role: "primary" }] },
  }),
  actorId: "user_1",
  requestSha256: "request_hash",
})

const mutationFixture = (
  variantId: string,
  index: number,
): CatalogVariantProfileMutationResult => ({
  created: true,
  createdReferenceValueIds: [`reference_${index}`],
  operationId: `operation_${index}`,
  previous: { profile: null },
  profileId: `variant_profile_${index}`,
  replayed: false,
  result: {},
  variantId,
  version: 1,
})

const targetsFixture = (command: CatalogProductCreateCommandInput) =>
  command.variants.map((definition, index) => ({
    definition,
    variantId: `variant_${index}`,
  }))

describe("catalog product creation audit", () => {
  it("reports actor-scoped retry state without exposing another operation", async () => {
    const service = serviceFixture()

    await expect(
      inspectCatalogProductCreation(
        service,
        "user_1",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe("absent")

    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        result: {},
        status: "compensated",
      },
    ] as never)
    await expect(
      inspectCatalogProductCreation(
        service,
        "user_1",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe("compensated")

    await expect(
      inspectCatalogProductCreation(
        service,
        "user_2",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe("unavailable")
  })

  it("accepts only a valid completed creation as succeeded", async () => {
    const service = serviceFixture()
    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        result: {
          kind: "merch",
          productId: "prod_1",
          profileId: "profile_1",
          variantIds: ["variant_1"],
        },
        status: "succeeded",
      },
    ] as never)

    await expect(
      inspectCatalogProductCreation(
        service,
        "user_1",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe("succeeded")

    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        result: {},
        status: "succeeded",
      },
    ] as never)
    await expect(
      inspectCatalogProductCreation(
        service,
        "user_1",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toThrow("no valid result")
  })

  it("creates one pending outer operation before commerce writes", async () => {
    const service = serviceFixture()
    service.createCatalogAuthoringOperations.mockResolvedValue([
      { id: "creation_operation" },
    ] as never)

    await expect(
      beginCatalogProductCreation(service, commandFixture()),
    ).resolves.toEqual({
      operationId: "creation_operation",
      replayed: false,
      result: null,
    })
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          aggregate_id:
            "catalog-product-create:00000000-0000-4000-8000-000000000001",
          command: "catalog.product.create",
          expected_version: 0,
          request_sha256: "request_hash",
          status: "pending",
        }),
      ],
      expect.anything(),
    )
  })

  it("replays only the exact completed command with a valid result", async () => {
    const service = serviceFixture()
    const result = {
      kind: "music_release",
      productId: "prod_1",
      profileId: "profile_1",
      variantIds: ["variant_1"],
    }
    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        expected_version: 0,
        id: "creation_operation",
        request_sha256: "request_hash",
        result,
        status: "succeeded",
      },
    ] as never)

    await expect(
      beginCatalogProductCreation(service, commandFixture()),
    ).resolves.toEqual({
      operationId: "creation_operation",
      replayed: true,
      result,
    })
    expect(service.createCatalogAuthoringOperations).not.toHaveBeenCalled()

    await expect(
      beginCatalogProductCreation(service, {
        ...commandFixture(),
        requestSha256: "different_hash",
      }),
    ).rejects.toThrow("cannot be replayed")

    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        expected_version: 0,
        id: "creation_operation",
        request_sha256: "request_hash",
        result: {},
        status: "succeeded",
      },
    ] as never)
    await expect(
      beginCatalogProductCreation(service, commandFixture()),
    ).rejects.toThrow("no valid result")

    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: "user_1",
        command: "catalog.product.create",
        expected_version: 0,
        id: "creation_operation",
        request_sha256: "request_hash",
        result: { ...result, kind: "unsupported_kind" },
        status: "succeeded",
      },
    ] as never)
    await expect(
      beginCatalogProductCreation(service, commandFixture()),
    ).rejects.toThrow("no valid result")
  })

  it("persists success and records compensation through the catalog service", async () => {
    const service = serviceFixture()
    const result = {
      kind: "music_release" as const,
      productId: "prod_1",
      profileId: "profile_1",
      variantIds: ["variant_1"],
    }

    await completeCatalogProductCreation(service, "creation_operation", result)
    expect(service.completeCatalogAuthoringOperation).toHaveBeenCalledWith(
      "creation_operation",
      result,
    )

    await compensateCatalogProductCreation(service, "creation_operation")
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          error_code: "workflow_compensated",
          id: "creation_operation",
          status: "compensated",
        }),
      ],
      expect.anything(),
    )
  })
})

describe("catalog product variant profile batch", () => {
  it("builds deterministic child commands and inherits native backorders", () => {
    const command = commandFixture()
    const targets = targetsFixture(command)
    const first = buildCatalogVariantProfileMutation(
      command,
      "prod_1",
      "profile_1",
      targets[1]!,
      1,
    )
    const replay = buildCatalogVariantProfileMutation(
      command,
      "prod_1",
      "profile_1",
      targets[1]!,
      1,
    )

    expect(first.idempotencyKey).toBe(replay.idempotencyKey)
    expect(first.patch).toMatchObject({
      backorderAllowed: true,
      productId: "prod_1",
      productProfileId: "profile_1",
    })
  })

  it("completes every variant operation after all profile fields are written", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    const targets = targetsFixture(command)
    const mutate = jest
      .fn()
      .mockResolvedValueOnce(mutationFixture("variant_0", 0))
      .mockResolvedValueOnce(mutationFixture("variant_1", 1))
    const compensate = jest.fn()

    await expect(
      mutateCatalogProductVariantProfiles(
        service,
        command,
        "prod_1",
        "profile_1",
        targets,
        { compensate, mutate },
      ),
    ).resolves.toMatchObject({
      profileIds: ["variant_profile_0", "variant_profile_1"],
      variantIds: ["variant_0", "variant_1"],
    })
    expect(service.completeCatalogAuthoringOperation).toHaveBeenCalledTimes(2)
    expect(compensate).not.toHaveBeenCalled()
  })

  it("rolls back earlier variants if a later mutation fails", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    const targets = targetsFixture(command)
    const failure = new Error("second variant failed")
    const mutate = jest
      .fn()
      .mockResolvedValueOnce(mutationFixture("variant_0", 0))
      .mockRejectedValueOnce(failure)
    const compensate = jest.fn().mockResolvedValue(undefined)

    await expect(
      mutateCatalogProductVariantProfiles(
        service,
        command,
        "prod_1",
        "profile_1",
        targets,
        { compensate, mutate },
      ),
    ).rejects.toBe(failure)
    expect(compensate).toHaveBeenCalledTimes(1)
    expect(compensate).toHaveBeenCalledWith(
      service,
      expect.objectContaining({ aggregateId: "variant_0" }),
    )
  })

  it("rolls back a mutation when persisting its completion fails", async () => {
    const service = serviceFixture()
    const command = commandFixture()
    service.completeCatalogAuthoringOperation.mockRejectedValueOnce(
      new Error("operation persistence failed"),
    )
    const compensate = jest.fn().mockResolvedValue(undefined)

    await expect(
      mutateCatalogProductVariantProfiles(
        service,
        command,
        "prod_1",
        "profile_1",
        targetsFixture(command).slice(0, 1),
        {
          compensate,
          mutate: jest
            .fn()
            .mockResolvedValue(mutationFixture("variant_0", 0)),
        },
      ),
    ).rejects.toThrow("operation persistence failed")
    expect(compensate).toHaveBeenCalledTimes(1)
  })

  it("compensates successful batches in reverse and reports rollback failures", async () => {
    const service = serviceFixture()
    const compensationA = {
      aggregateId: "variant_0",
      createdReferenceValueIds: [],
      operationId: "operation_0",
      previous: { profile: null },
    }
    const compensationB = {
      ...compensationA,
      aggregateId: "variant_1",
      operationId: "operation_1",
    }
    const compensate = jest.fn().mockResolvedValue(undefined)
    const result = {
      compensations: [compensationA, compensationB],
      profileIds: ["profile_0", "profile_1"],
      variantIds: ["variant_0", "variant_1"],
    }

    await compensateCatalogProductVariantProfiles(service, result, {
      compensate,
      mutate: jest.fn(),
    })
    expect(compensate.mock.calls.map((call) => call[1].aggregateId)).toEqual([
      "variant_1",
      "variant_0",
    ])

    compensate.mockRejectedValueOnce(new Error("rollback failed"))
    await expect(
      compensateCatalogProductVariantProfiles(service, result, {
        compensate,
        mutate: jest.fn(),
      }),
    ).rejects.toThrow("variant profile compensations failed")
  })
})
