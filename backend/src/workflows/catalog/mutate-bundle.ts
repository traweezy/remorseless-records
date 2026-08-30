import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import {
  reconcileComponentDerivedBundleInventory,
  restoreBundleInventoryReconciliation,
  type BundleInventoryReconciliationSnapshot,
} from "@/lib/catalog/bundle-inventory"
import type {
  CatalogBundleMutationInput,
  CatalogBundleMutationResult,
} from "@/modules/catalog/bundle-authoring"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

type MutationCompensation = {
  aggregateId: string
  operationId: string
  previous: CatalogBundleMutationResult["previous"]
}

type InventoryStepInput = {
  input: CatalogBundleMutationInput
  mutation: CatalogBundleMutationResult
}

type InventoryStepOutput = {
  snapshot: BundleInventoryReconciliationSnapshot | null
}

type CompletionStepInput = InventoryStepInput & {
  inventory: InventoryStepOutput
}

type InventoryCompensation = {
  productId: string
  snapshot: BundleInventoryReconciliationSnapshot
}

const mutateBundleStep = createStep(
  "mutate-catalog-bundle",
  async (
    input: CatalogBundleMutationInput,
    { container }
  ): Promise<
    StepResponse<CatalogBundleMutationResult, MutationCompensation | null>
  > => {
    const catalogService = container.resolve("catalog") as CatalogService
    const result = await catalogService.mutateBundle(input)
    return new StepResponse(
      result,
      result.replayed
        ? null
        : {
            aggregateId: input.aggregateId,
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
    await catalogService.compensateBundleMutation(compensation)
  }
)

const reconcileBundleInventoryStep = createStep(
  {
    name: "reconcile-catalog-bundle-inventory",
    maxRetries: 2,
    retryInterval: 1,
  },
  async (
    { input, mutation }: InventoryStepInput,
    { container }
  ): Promise<
    StepResponse<InventoryStepOutput, InventoryCompensation | null>
  > => {
    if (mutation.replayed) {
      return new StepResponse({ snapshot: null }, null)
    }
    const { snapshot } = await reconcileComponentDerivedBundleInventory(
      container,
      input.aggregateId,
      mutation.previous
    )
    return new StepResponse(
      { snapshot },
      { productId: input.aggregateId, snapshot }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    await restoreBundleInventoryReconciliation(
      container,
      compensation.productId,
      compensation.snapshot
    )
  }
)

const completeBundleOperationStep = createStep(
  "complete-catalog-bundle-operation",
  async ({
    input,
    mutation,
  }: CompletionStepInput): Promise<
    StepResponse<CatalogBundleMutationResult>
  > => {
    if (mutation.replayed) {
      return new StepResponse(mutation)
    }
    const result = {
      deleted: mutation.profileId === null,
      profileId: mutation.profileId,
      productId: input.aggregateId,
      version: mutation.version,
    }
    return new StepResponse({
      ...mutation,
      result,
    })
  }
)

const persistBundleOperationStep = createStep(
  "persist-catalog-bundle-operation",
  async (
    mutation: CatalogBundleMutationResult,
    { container }
  ): Promise<StepResponse<CatalogBundleMutationResult>> => {
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

export const mutateCatalogBundleWorkflow = createWorkflow(
  {
    name: "mutate-catalog-bundle",
    store: true,
    retentionTime: 60 * 60 * 24 * 30,
    timeout: 60,
  },
  function (input: CatalogBundleMutationInput) {
    const lockKey = transform(
      { aggregateId: input.aggregateId },
      ({ aggregateId }) => `catalog:bundle:${aggregateId}`
    )
    acquireLockStep({
      key: lockKey,
      timeout: 10,
      ttl: 120,
    })
    const mutation = mutateBundleStep(input)
    const inventory = reconcileBundleInventoryStep({ input, mutation })
    const completed = completeBundleOperationStep({
      input,
      mutation,
      inventory,
    })
    const persisted = persistBundleOperationStep(completed)
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(persisted)
  }
)
