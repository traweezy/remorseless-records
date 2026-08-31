import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"

import {
  compensateCatalogMediaLifecycle,
  mutateCatalogMediaLifecycle,
  type CatalogMediaLifecycleInput,
  type CatalogMediaLifecycleMutation,
} from "@/lib/catalog/media-lifecycle"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

type LifecycleCompensation = Pick<
  CatalogMediaLifecycleMutation,
  "assetId" | "operationId" | "previous"
>

const mutateMediaLifecycleStep = createStep(
  "mutate-catalog-media-lifecycle",
  async (
    input: CatalogMediaLifecycleInput,
    { container }
  ): Promise<
    StepResponse<CatalogMediaLifecycleMutation, LifecycleCompensation | null>
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const mutation = await mutateCatalogMediaLifecycle(catalogService, input)
    return new StepResponse(
      mutation,
      mutation.replayed
        ? null
        : {
            assetId: mutation.assetId,
            operationId: mutation.operationId,
            previous: mutation.previous,
          }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const catalogService = container.resolve<CatalogService>("catalog")
    await compensateCatalogMediaLifecycle(catalogService, compensation)
  }
)

const completeMediaLifecycleStep = createStep(
  "complete-catalog-media-lifecycle",
  async (
    mutation: CatalogMediaLifecycleMutation,
    { container }
  ): Promise<StepResponse<CatalogMediaLifecycleMutation>> => {
    if (!mutation.replayed) {
      const catalogService = container.resolve<CatalogService>("catalog")
      await catalogService.completeCatalogAuthoringOperation(
        mutation.operationId,
        {
          assetId: mutation.assetId,
          lifecycleStatus: mutation.lifecycleStatus,
          purgeEligibleAt: mutation.purgeEligibleAt,
          quarantinedAt: mutation.quarantinedAt,
          version: mutation.version,
        }
      )
    }
    return new StepResponse(mutation)
  }
)

export const mutateCatalogMediaLifecycleWorkflow = createWorkflow(
  {
    name: "mutate-catalog-media-lifecycle",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  (input: CatalogMediaLifecycleInput) => {
    const lockKey = transform(
      { assetId: input.assetId },
      ({ assetId }) => `catalog:media-asset:${assetId}`
    )
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 120 })
    const mutation = mutateMediaLifecycleStep(input)
    const completed = completeMediaLifecycleStep(mutation)
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(completed)
  }
)
