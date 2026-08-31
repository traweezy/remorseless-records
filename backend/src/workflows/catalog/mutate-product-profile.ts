import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  compensateCatalogProductProfileMutation,
  mutateCatalogProductProfile,
  type CatalogProductProfileMutationInput,
  type CatalogProductProfileMutationResult,
} from "@/lib/catalog/product-profile-authoring"
import { readProfileOperationMutation } from "@/lib/catalog/profile-persistence-contracts"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

type MutationCompensation = {
  aggregateId: string
  createdArtistIds: string[]
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogProductProfileMutationResult["previous"]
}

const mutateProductProfileStep = createStep(
  "mutate-catalog-product-profile",
  async (
    input: CatalogProductProfileMutationInput,
    { container }
  ): Promise<
    StepResponse<
      CatalogProductProfileMutationResult,
      MutationCompensation | null
    >
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const result = await mutateCatalogProductProfile(catalogService, input)
    return new StepResponse(
      result,
      result.replayed
        ? null
        : {
            aggregateId: input.aggregateId,
            createdArtistIds: result.createdArtistIds,
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
    const catalogService = container.resolve<CatalogService>("catalog")
    await compensateCatalogProductProfileMutation(catalogService, compensation)
  }
)

const completeProductProfileStep = createStep(
  "complete-catalog-product-profile",
  async (
    mutation: CatalogProductProfileMutationResult
  ): Promise<StepResponse<CatalogProductProfileMutationResult>> => {
    if (mutation.replayed) {
      return new StepResponse(mutation)
    }
    return new StepResponse({
      ...mutation,
      result: {
        created: mutation.created,
        productId: mutation.productId,
        profileId: mutation.profileId,
        version: mutation.version,
      },
    })
  }
)

const persistProductProfileOperationStep = createStep(
  "persist-catalog-product-profile-operation",
  async (
    mutation: CatalogProductProfileMutationResult,
    { container }
  ): Promise<StepResponse<CatalogProductProfileMutationResult>> => {
    if (!mutation.replayed) {
      const catalogService = container.resolve<CatalogService>("catalog")
      readProfileOperationMutation(
        await catalogService.completeCatalogAuthoringOperation(
          mutation.operationId,
          mutation.result
        ),
        {
          actorId: mutation.actorId,
          aggregateId: mutation.productId,
          command: "catalog.product-profile.upsert",
          expectedVersion: mutation.version - 1,
          id: mutation.operationId,
          idempotencyKey: mutation.idempotencyKey,
          requestSha256: mutation.requestSha256,
          result: mutation.result,
          status: "succeeded",
        }
      )
    }
    return new StepResponse(mutation)
  }
)

export const mutateCatalogProductProfileWorkflow = createWorkflow(
  {
    name: "mutate-catalog-product-profile",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  (input: CatalogProductProfileMutationInput) => {
    const lockKey = transform(
      { aggregateId: input.aggregateId },
      ({ aggregateId }) => `catalog:product-profile:${aggregateId}`
    )
    acquireLockStep({
      key: lockKey,
      timeout: 10,
      ttl: 120,
    })
    const mutation = mutateProductProfileStep(input)
    const completed = completeProductProfileStep(mutation)
    const persisted = persistProductProfileOperationStep(completed)
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(persisted)
  }
)
