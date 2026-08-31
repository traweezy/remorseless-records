import { MedusaError } from "@medusajs/framework/utils"

import {
  compensateCatalogVariantProfileMutation,
  mutateCatalogVariantProfile,
} from "./variant-profile-authoring"
import type {
  CatalogVariantProfileMutationInput,
  CatalogVariantProfileMutationResult,
} from "./variant-profile-contract"
import type { CatalogService } from "./reference-resolution"
import {
  catalogProductCreationKinds,
  type CatalogProductCreateInput,
} from "./product-create-contract"
import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "../../modules/catalog/catalog-command"
import { coerceCatalogJsonRecord } from "./normalization"

export type CatalogProductCreateCommandInput = CatalogProductCreateInput & {
  actorId: string | null
  requestSha256: string
}

export type CatalogProductCreateResult = {
  kind: CatalogProductCreateInput["kind"]
  productId: string
  profileId: string
  variantIds: string[]
}

export type CatalogProductCreateOperation = {
  operationId: string
  replayed: boolean
  result: CatalogProductCreateResult | null
}

export const catalogProductCreationStates = [
  "absent",
  "compensated",
  "failed",
  "pending",
  "succeeded",
  "unavailable",
] as const

export type CatalogProductCreationState =
  (typeof catalogProductCreationStates)[number]

type VariantTarget = {
  definition: CatalogProductCreateInput["variants"][number]
  variantId: string
}

type VariantMutationCompensation = {
  aggregateId: string
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogVariantProfileMutationResult["previous"]
}

type VariantMutationDependencies = {
  compensate: typeof compensateCatalogVariantProfileMutation
  mutate: typeof mutateCatalogVariantProfile
}

const variantMutationDependencies: VariantMutationDependencies = {
  compensate: compensateCatalogVariantProfileMutation,
  mutate: mutateCatalogVariantProfile,
}

export type CatalogProductVariantBatchResult = {
  compensations: VariantMutationCompensation[]
  profileIds: string[]
  variantIds: string[]
}

const creationAggregateId = (idempotencyKey: string): string =>
  `catalog-product-create:${idempotencyKey}`

const isCreateResult = (
  value: unknown
): value is CatalogProductCreateResult => {
  const result = coerceCatalogJsonRecord(value)
  return (
    catalogProductCreationKinds.some((kind) => kind === result.kind) &&
    typeof result.productId === "string" &&
    typeof result.profileId === "string" &&
    Array.isArray(result.variantIds) &&
    result.variantIds.every((variantId) => typeof variantId === "string")
  )
}

export const inspectCatalogProductCreation = async (
  catalogService: CatalogService,
  actorId: string | null,
  idempotencyKey: string
): Promise<CatalogProductCreationState> => {
  const existing = (
    await catalogService.listCatalogAuthoringOperations(
      { idempotency_key: idempotencyKey },
      { take: 1 }
    )
  )[0]
  if (!existing) {
    return "absent"
  }
  if (
    existing.actor_id !== actorId ||
    existing.command !== "catalog.product.create"
  ) {
    return "unavailable"
  }
  if (existing.status === "succeeded") {
    if (!isCreateResult(existing.result)) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The completed catalog creation command has no valid result."
      )
    }
    return "succeeded"
  }
  if (
    existing.status === "compensated" ||
    existing.status === "failed" ||
    existing.status === "pending"
  ) {
    return existing.status
  }
  return "unavailable"
}

export const beginCatalogProductCreation = async (
  catalogService: CatalogService,
  input: CatalogProductCreateCommandInput
): Promise<CatalogProductCreateOperation> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const existing = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext
      )
    )[0]
    if (existing) {
      const exactCommand =
        existing.command === "catalog.product.create" &&
        existing.actor_id === input.actorId &&
        existing.expected_version === 0 &&
        existing.request_sha256 === input.requestSha256
      if (!exactCommand || existing.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog creation idempotency key cannot be replayed for this command."
        )
      }
      if (!isCreateResult(existing.result)) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed catalog creation command has no valid result."
        )
      }
      return {
        operationId: existing.id,
        replayed: true,
        result: existing.result,
      }
    }

    const [operation] = await catalogService.createCatalogAuthoringOperations(
      [
        {
          actor_id: input.actorId,
          aggregate_id: creationAggregateId(input.idempotencyKey),
          command: "catalog.product.create",
          expected_version: 0,
          idempotency_key: input.idempotencyKey,
          metadata: { kind: input.kind },
          request_sha256: input.requestSha256,
          result: {},
          status: "pending",
        },
      ],
      sharedContext
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation audit record was not created."
      )
    }
    return { operationId: operation.id, replayed: false, result: null }
  })

export const completeCatalogProductCreation = async (
  catalogService: CatalogService,
  operationId: string,
  result: CatalogProductCreateResult
): Promise<void> => {
  await catalogService.completeCatalogAuthoringOperation(operationId, result)
}

export const compensateCatalogProductCreation = async (
  catalogService: CatalogService,
  operationId: string
): Promise<void> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: "workflow_compensated",
          error_detail:
            "Catalog product creation failed; all completed creation steps were restored.",
          id: operationId,
          status: "compensated",
        },
      ],
      sharedContext
    )
  })

export const buildCatalogVariantProfileMutation = (
  input: CatalogProductCreateCommandInput,
  productId: string,
  productProfileId: string,
  target: VariantTarget,
  index: number
): CatalogVariantProfileMutationInput => {
  const patch = {
    ...target.definition.profile,
    backorderAllowed:
      target.definition.profile?.backorderAllowed ??
      target.definition.allowBackorder ??
      false,
    productId,
    productProfileId,
  }
  const commandPayload = {
    command: "catalog.variant-profile.upsert" as const,
    expectedVersion: 0,
    patch,
    variantId: target.variantId,
  }
  return {
    actorId: input.actorId,
    aggregateId: target.variantId,
    command: "catalog.variant-profile.upsert",
    expectedVersion: 0,
    idempotencyKey: deriveCatalogCommandIdempotencyKey(
      input.idempotencyKey,
      `variant:${index}:${target.definition.key}`
    ),
    patch,
    requestSha256: hashCatalogCommand(commandPayload),
  }
}

const compensationFromMutation = (
  mutation: CatalogVariantProfileMutationResult
): VariantMutationCompensation => ({
  aggregateId: mutation.variantId,
  createdReferenceValueIds: mutation.createdReferenceValueIds,
  operationId: mutation.operationId,
  previous: mutation.previous,
})

const compensateVariantMutations = async (
  catalogService: CatalogService,
  compensations: VariantMutationCompensation[],
  dependencies: VariantMutationDependencies
): Promise<void> => {
  const failures: unknown[] = []
  for (const compensation of [...compensations].reverse()) {
    try {
      await dependencies.compensate(catalogService, compensation)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "One or more variant profile compensations failed."
    )
  }
}

export const mutateCatalogProductVariantProfiles = async (
  catalogService: CatalogService,
  input: CatalogProductCreateCommandInput,
  productId: string,
  productProfileId: string,
  targets: VariantTarget[],
  dependencies: VariantMutationDependencies = variantMutationDependencies
): Promise<CatalogProductVariantBatchResult> => {
  const compensations: VariantMutationCompensation[] = []
  const profileIds: string[] = []
  try {
    for (const [index, target] of targets.entries()) {
      const mutation = await dependencies.mutate(
        catalogService,
        buildCatalogVariantProfileMutation(
          input,
          productId,
          productProfileId,
          target,
          index
        )
      )
      if (!mutation.replayed) {
        compensations.push(compensationFromMutation(mutation))
        await catalogService.completeCatalogAuthoringOperation(
          mutation.operationId,
          {
            created: mutation.created,
            profileId: mutation.profileId,
            variantId: mutation.variantId,
            version: mutation.version,
          }
        )
      }
      profileIds.push(mutation.profileId)
    }
  } catch (error) {
    try {
      await compensateVariantMutations(
        catalogService,
        compensations,
        dependencies
      )
    } catch (compensationError) {
      throw new AggregateError(
        [error, compensationError],
        "Variant profile creation and its rollback both failed."
      )
    }
    throw error
  }

  return {
    compensations,
    profileIds,
    variantIds: targets.map((target) => target.variantId),
  }
}

export const compensateCatalogProductVariantProfiles = async (
  catalogService: CatalogService,
  result: CatalogProductVariantBatchResult,
  dependencies: VariantMutationDependencies = variantMutationDependencies
): Promise<void> =>
  compensateVariantMutations(catalogService, result.compensations, dependencies)
