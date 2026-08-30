import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  compensateCatalogVariantProfileMutation,
  mutateCatalogVariantProfile,
  type CatalogVariantProfileMutationInput,
  type CatalogVariantProfileMutationResult,
} from "@/lib/catalog/variant-profile-authoring"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

type MutationCompensation = {
  aggregateId: string
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogVariantProfileMutationResult["previous"]
}

const mutateVariantProfileStep = createStep(
  "mutate-catalog-variant-profile",
  async (
    input: CatalogVariantProfileMutationInput,
    { container }
  ): Promise<
    StepResponse<
      CatalogVariantProfileMutationResult,
      MutationCompensation | null
    >
  > => {
    const catalogService = container.resolve("catalog") as CatalogService
    const result = await mutateCatalogVariantProfile(catalogService, input)
    return new StepResponse(
      result,
      result.replayed
        ? null
        : {
            aggregateId: input.aggregateId,
            createdReferenceValueIds: result.createdReferenceValueIds,
            operationId: result.operationId,
            previous: result.previous,
          }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const catalogService = container.resolve("catalog") as CatalogService
    await compensateCatalogVariantProfileMutation(catalogService, compensation)
  }
)

const completeVariantProfileStep = createStep(
  "complete-catalog-variant-profile",
  async (
    mutation: CatalogVariantProfileMutationResult
  ): Promise<StepResponse<CatalogVariantProfileMutationResult>> => {
    if (mutation.replayed) {
      return new StepResponse(mutation)
    }
    return new StepResponse({
      ...mutation,
      result: {
        created: mutation.created,
        profileId: mutation.profileId,
        variantId: mutation.variantId,
        version: mutation.version,
      },
    })
  }
)

const persistVariantProfileOperationStep = createStep(
  "persist-catalog-variant-profile-operation",
  async (
    mutation: CatalogVariantProfileMutationResult,
    { container }
  ): Promise<StepResponse<CatalogVariantProfileMutationResult>> => {
    if (!mutation.replayed) {
      const catalogService = container.resolve("catalog") as CatalogService
      await catalogService.completeCatalogAuthoringOperation(
        mutation.operationId,
        mutation.result
      )
    }
    return new StepResponse(mutation)
  }
)

export const mutateCatalogVariantProfileWorkflow = createWorkflow(
  {
    name: "mutate-catalog-variant-profile",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  function (input: CatalogVariantProfileMutationInput) {
    const lockKey = transform(
      { aggregateId: input.aggregateId },
      ({ aggregateId }) => `catalog:variant-profile:${aggregateId}`
    )
    acquireLockStep({
      key: lockKey,
      timeout: 10,
      ttl: 120,
    })
    const mutation = mutateVariantProfileStep(input)
    const completed = completeVariantProfileStep(mutation)
    const persisted = persistVariantProfileOperationStep(completed)
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(persisted)
  }
)
