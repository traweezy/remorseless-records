import { acquireLockStep } from "@medusajs/medusa/core-flows"
import { randomUUID } from "node:crypto"
import type { IProductModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
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
  readCommittedCatalogProductProfileOperation,
  type CatalogProductProfileMutationInput,
  type CatalogProductProfileMutationResult,
} from "@/lib/catalog/product-profile-authoring"
import { readProfileOperationMutation } from "@/lib/catalog/profile-persistence-contracts"
import type CatalogModuleService from "@/modules/catalog/service"
import {
  planNativeCatalogMediaProjection,
  type NativeMediaProjectionSnapshot,
} from "@/lib/catalog/native-media-projection"
import { projectNativeMediaStep } from "./native-media-projection"
import {
  CATALOG_MEDIA_LEASE_SECONDS,
  releaseCommittedCatalogMediaLease,
  type CatalogMediaLease,
} from "./media-lease"

type CatalogService = InstanceType<typeof CatalogModuleService>

type MutationCompensation = {
  aggregateId: string
  createdArtistIds: string[]
  createdReferenceValueIds: string[]
  operationId: string
  previous: CatalogProductProfileMutationResult["previous"]
}

const resolveProfileMediaLeaseStep = createStep(
  "resolve-catalog-profile-media-lease",
  async (input: CatalogProductProfileMutationInput) =>
    new StepResponse({
      keys: [
        `catalog:product-media:${input.aggregateId}`,
        `catalog:product-profile:${input.aggregateId}`,
      ],
      ownerId: randomUUID(),
    })
)

const planProfileMediaStep = createStep(
  "plan-native-catalog-profile-media",
  async (input: CatalogProductProfileMutationInput, { container }) => {
    const catalog = container.resolve<CatalogService>("catalog")
    if (await readCommittedCatalogProductProfileOperation(catalog, input))
      return new StepResponse(null)
    return new StepResponse(
      await planNativeCatalogMediaProjection(
        container.resolve<IProductModuleService>(Modules.PRODUCT),
        catalog,
        { aggregateId: input.aggregateId, media: [] }
      )
    )
  }
)

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
  async ({
    mutation,
  }: {
    mutation: CatalogProductProfileMutationResult
    projection: NativeMediaProjectionSnapshot | null
  }): Promise<StepResponse<CatalogProductProfileMutationResult>> => {
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
    {
      mutation,
      lease,
    }: {
      mutation: CatalogProductProfileMutationResult
      lease: CatalogMediaLease
    },
    { container, parentStepIdempotencyKey }
  ): Promise<StepResponse<CatalogProductProfileMutationResult>> => {
    if (!mutation.replayed && !parentStepIdempotencyKey) {
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
    if (!parentStepIdempotencyKey)
      await releaseCommittedCatalogMediaLease(container, lease)
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
    const lease = resolveProfileMediaLeaseStep(input)
    acquireLockStep({
      key: lease.keys,
      ownerId: lease.ownerId,
      timeout: 10,
      ttl: CATALOG_MEDIA_LEASE_SECONDS,
    })
    const plan = planProfileMediaStep(input)
    const mutationInput = transform({ input, plan }, ({ input }) => input)
    const mutation = mutateProductProfileStep(mutationInput)
    const projection = projectNativeMediaStep({ mutation, plan })
    const completed = completeProductProfileStep({ mutation, projection })
    const persisted = persistProductProfileOperationStep({
      mutation: completed,
      lease,
    })
    return new WorkflowResponse(persisted)
  }
)
