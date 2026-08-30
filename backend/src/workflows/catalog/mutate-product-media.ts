import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"

import {
  compensateCatalogProductMediaMutation,
  mutateCatalogProductMedia,
  type CatalogProductMediaMutationInput,
  type CatalogProductMediaMutationResult,
} from "@/lib/catalog/product-media-authoring"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

type MutationCompensation = {
  aggregateId: string
  createdAssetIds: string[]
  operationId: string
  previous: CatalogProductMediaMutationResult["previous"]
}

const mutateProductMediaStep = createStep(
  "mutate-catalog-product-media",
  async (
    input: CatalogProductMediaMutationInput,
    { container }
  ): Promise<
    StepResponse<CatalogProductMediaMutationResult, MutationCompensation | null>
  > => {
    const catalogService = container.resolve("catalog") as CatalogService
    const result = await mutateCatalogProductMedia(catalogService, input)
    return new StepResponse(
      result,
      result.replayed
        ? null
        : {
            aggregateId: input.aggregateId,
            createdAssetIds: result.createdAssetIds,
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
    await compensateCatalogProductMediaMutation(catalogService, compensation)
  }
)

const completeProductMediaStep = createStep(
  "complete-catalog-product-media",
  async (
    mutation: CatalogProductMediaMutationResult
  ): Promise<StepResponse<CatalogProductMediaMutationResult>> => {
    if (mutation.replayed) {
      return new StepResponse(mutation)
    }
    return new StepResponse({
      ...mutation,
      result: {
        productId: mutation.productId,
        version: mutation.version,
      },
    })
  }
)

const persistProductMediaOperationStep = createStep(
  "persist-catalog-product-media-operation",
  async (
    mutation: CatalogProductMediaMutationResult,
    { container }
  ): Promise<StepResponse<CatalogProductMediaMutationResult>> => {
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

export const mutateCatalogProductMediaWorkflow = createWorkflow(
  {
    name: "mutate-catalog-product-media",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  (input: CatalogProductMediaMutationInput) => {
    const lockKeys = transform({ input }, ({ input: workflowInput }) => [
      `catalog:product-media:${workflowInput.aggregateId}`,
      ...[
        ...new Set(
          workflowInput.media
            .map(({ mediaAssetId }) => mediaAssetId?.trim())
            .filter((id): id is string => Boolean(id))
        ),
      ].map((id) => `catalog:media-asset:${id}`),
    ])
    acquireLockStep({
      key: lockKeys,
      timeout: 10,
      ttl: 120,
    })
    const mutation = mutateProductMediaStep(input)
    const completed = completeProductMediaStep(mutation)
    const persisted = persistProductMediaOperationStep(completed)
    releaseLockStep({ key: lockKeys })
    return new WorkflowResponse(persisted)
  }
)
