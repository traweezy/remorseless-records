import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep } from "@medusajs/medusa/core-flows"
import { randomUUID } from "node:crypto"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

import {
  compensateCatalogProductMediaMutation,
  mutateCatalogProductMedia,
  type CatalogProductMediaMutationInput,
  type CatalogProductMediaMutationResult,
} from "@/lib/catalog/product-media-authoring"
import type CatalogModuleService from "@/modules/catalog/service"
import {
  planNativeCatalogMediaProjection,
  type NativeMediaProjectionSnapshot,
} from "@/lib/catalog/native-media-projection"
import {
  assertCatalogMediaLockCoverage,
  resolveCatalogProductMediaLockKeys,
} from "@/lib/catalog/product-media-locks"
import { readCommittedCatalogProductMediaReplay } from "@/lib/catalog/product-media-replay"
import { projectNativeMediaStep } from "./native-media-projection"
import {
  CATALOG_MEDIA_LEASE_SECONDS,
  releaseCommittedCatalogMediaLease,
  type CatalogMediaLease,
} from "./media-lease"

type CatalogService = InstanceType<typeof CatalogModuleService>

// Creation is the sole composed caller. This internal evidence is constructed
// by that workflow; no authoring HTTP request schema accepts it.
export type CatalogProductMediaWorkflowInput =
  CatalogProductMediaMutationInput & {
    inheritedMediaLease?: CatalogMediaLease
  }

type MutationCompensation = {
  aggregateId: string
  createdAssetIds: string[]
  operationId: string
  previous: CatalogProductMediaMutationResult["previous"]
}

const resolveMediaLockKeysStep = createStep(
  "resolve-catalog-product-media-locks",
  async (input: CatalogProductMediaWorkflowInput, { container }) => {
    const catalog = container.resolve<CatalogService>("catalog")
    const required = await resolveCatalogProductMediaLockKeys(catalog, input)
    if (input.inheritedMediaLease) {
      assertCatalogMediaLockCoverage(required, input.inheritedMediaLease.keys)
      return new StepResponse({ ...input.inheritedMediaLease, inherited: true })
    }
    return new StepResponse({
      keys: required,
      ownerId: randomUUID(),
      inherited: false,
    })
  }
)

const planNativeMediaStep = createStep(
  "plan-native-catalog-product-media",
  async (
    {
      input,
      lockKeys,
    }: { input: CatalogProductMediaMutationInput; lockKeys: string[] },
    { container }
  ) => {
    const catalog = container.resolve<CatalogService>("catalog")
    if (await readCommittedCatalogProductMediaReplay(catalog, input))
      return new StepResponse(null)
    assertCatalogMediaLockCoverage(
      await resolveCatalogProductMediaLockKeys(catalog, input),
      lockKeys
    )
    return new StepResponse(
      await planNativeCatalogMediaProjection(
        container.resolve<IProductModuleService>(Modules.PRODUCT),
        catalog,
        input
      )
    )
  }
)

const mutateProductMediaStep = createStep(
  "mutate-catalog-product-media",
  async (
    {
      input,
      lockKeys,
    }: { input: CatalogProductMediaMutationInput; lockKeys: string[] },
    { container }
  ): Promise<
    StepResponse<CatalogProductMediaMutationResult, MutationCompensation | null>
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const result = await mutateCatalogProductMedia(catalogService, input, {
      lockKeys,
    })
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
    const catalogService = container.resolve<CatalogService>("catalog")
    await compensateCatalogProductMediaMutation(catalogService, compensation)
  }
)

const completeProductMediaStep = createStep(
  "complete-catalog-product-media",
  async ({
    mutation,
  }: {
    mutation: CatalogProductMediaMutationResult
    projection: NativeMediaProjectionSnapshot | null
  }): Promise<StepResponse<CatalogProductMediaMutationResult>> => {
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
    {
      mutation,
      lease,
    }: {
      mutation: CatalogProductMediaMutationResult
      lease: CatalogMediaLease
    },
    { container, parentStepIdempotencyKey }
  ): Promise<StepResponse<CatalogProductMediaMutationResult>> => {
    if (!mutation.replayed && !parentStepIdempotencyKey) {
      const catalogService = container.resolve<CatalogService>("catalog")
      await catalogService.completeCatalogAuthoringOperation(
        mutation.operationId,
        mutation.result
      )
    }
    if (!parentStepIdempotencyKey)
      await releaseCommittedCatalogMediaLease(container, lease)
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
  (input: CatalogProductMediaWorkflowInput) => {
    const lease = resolveMediaLockKeysStep(input)
    acquireLockStep({
      key: transform({ lease }, ({ lease }) =>
        lease.inherited ? [] : lease.keys
      ),
      ownerId: lease.ownerId,
      executeOnSubWorkflow: true,
      timeout: 10,
      ttl: CATALOG_MEDIA_LEASE_SECONDS,
    })
    const plan = planNativeMediaStep({ input, lockKeys: lease.keys })
    const mutationInput = transform({ input, plan }, ({ input }) => input)
    const mutation = mutateProductMediaStep({
      input: mutationInput,
      lockKeys: lease.keys,
    })
    const projection = projectNativeMediaStep({ mutation, plan })
    const completed = completeProductMediaStep({ mutation, projection })
    const persisted = persistProductMediaOperationStep({
      mutation: completed,
      lease,
    })
    return new WorkflowResponse(persisted)
  }
)
