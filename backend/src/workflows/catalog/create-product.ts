import {
  acquireLockStep,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  releaseLockStep,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { resolveCatalogProductMediaLockKeys } from "@/lib/catalog/product-media-locks"

import {
  beginCatalogProductCreation,
  completeCatalogProductCreation,
  compensateCatalogProductCreation,
  compensateCatalogProductVariantProfiles,
  mutateCatalogProductVariantProfiles,
  type CatalogProductCreateCommandInput,
  type CatalogProductCreateOperation,
  type CatalogProductCreateResult,
  type CatalogProductVariantBatchResult,
} from "@/lib/catalog/product-create-authoring"
import {
  buildCatalogBundleMutation,
  buildCatalogNativeProduct,
  buildCatalogProductMediaMutation,
  buildCatalogProductProfileMutation,
  resolveCatalogCreatedProduct,
  resolveCatalogProductCreateContext,
  resolveCatalogProductInventoryLevels,
  type CatalogCreatedProduct,
  type CatalogProductCreateContext,
} from "@/lib/catalog/product-create-planning"
import type { CatalogProductProfileMutationResult } from "@/lib/catalog/product-profile-contract"
import type { CatalogProductMediaMutationResult } from "@/lib/catalog/product-media-authoring"
import type { CatalogBundleMutationResult } from "@/modules/catalog/bundle-authoring"
import type CatalogModuleService from "@/modules/catalog/service"
import { mutateCatalogBundleWorkflow } from "./mutate-bundle"
import { mutateCatalogProductMediaWorkflow } from "./mutate-product-media"
import { mutateCatalogProductProfileWorkflow } from "./mutate-product-profile"
import {
  CATALOG_MEDIA_LEASE_SECONDS,
  releaseCommittedCatalogMediaLease,
  type CatalogMediaLease,
} from "./media-lease"

type CatalogService = InstanceType<typeof CatalogModuleService>

type CreationOperationCompensation = {
  operationId: string
}

type VariantBatchWorkflowInput = {
  command: CatalogProductCreateCommandInput
  created: CatalogCreatedProduct
  productProfileId: string
}

type InventoryResolutionInput = {
  command: CatalogProductCreateCommandInput
  context: CatalogProductCreateContext
  created: CatalogCreatedProduct
}

type CompletionInput = {
  bundle: CatalogBundleMutationResult | undefined
  command: CatalogProductCreateCommandInput
  created: CatalogCreatedProduct | undefined
  inventory: unknown
  managedInventory: unknown
  media: CatalogProductMediaMutationResult | undefined
  mediaLease: CatalogMediaLease | undefined
  operation: CatalogProductCreateOperation
  profile: CatalogProductProfileMutationResult | undefined
  variants: CatalogProductVariantBatchResult | undefined
}

export type CatalogProductCreateWorkflowResult = CatalogProductCreateResult & {
  replayed: boolean
}

const beginCatalogProductCreationStep = createStep(
  "begin-catalog-product-creation",
  async (
    input: CatalogProductCreateCommandInput,
    { container }
  ): Promise<
    StepResponse<
      CatalogProductCreateOperation,
      CreationOperationCompensation | null
    >
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const operation = await beginCatalogProductCreation(catalogService, input)
    return new StepResponse(
      operation,
      operation.replayed ? null : { operationId: operation.operationId }
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const catalogService = container.resolve<CatalogService>("catalog")
    await compensateCatalogProductCreation(
      catalogService,
      compensation.operationId
    )
  }
)

const resolveCatalogProductCreateContextStep = createStep(
  "resolve-catalog-product-create-context",
  async (
    input: CatalogProductCreateCommandInput,
    { container }
  ): Promise<StepResponse<CatalogProductCreateContext>> =>
    new StepResponse(await resolveCatalogProductCreateContext(container, input))
)

const resolveCatalogCreatedProductStep = createStep(
  "resolve-catalog-created-product",
  async (
    {
      command,
      products,
    }: {
      command: CatalogProductCreateCommandInput
      products: Parameters<typeof resolveCatalogCreatedProduct>[2]
    },
    { container }
  ): Promise<StepResponse<CatalogCreatedProduct>> =>
    new StepResponse(
      await resolveCatalogCreatedProduct(container, command, products)
    )
)

const resolveCreatedMediaLeaseStep = createStep(
  "resolve-created-catalog-media-lease",
  async (
    {
      command,
      created,
    }: {
      command: CatalogProductCreateCommandInput
      created: CatalogCreatedProduct
    },
    { container }
  ) =>
    new StepResponse({
      keys: await resolveCatalogProductMediaLockKeys(
        container.resolve<CatalogService>("catalog"),
        { aggregateId: created.productId, media: command.media }
      ),
      ownerId: randomUUID(),
    })
)

const mutateCatalogProductVariantProfilesStep = createStep(
  "mutate-catalog-product-variant-profiles-batch",
  async (
    input: VariantBatchWorkflowInput,
    { container }
  ): Promise<
    StepResponse<
      CatalogProductVariantBatchResult,
      CatalogProductVariantBatchResult
    >
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const result = await mutateCatalogProductVariantProfiles(
      catalogService,
      input.command,
      input.created.productId,
      input.productProfileId,
      input.created.targets
    )
    return new StepResponse(result, result)
  },
  async (result, { container }) => {
    if (!result) {
      return
    }
    const catalogService = container.resolve<CatalogService>("catalog")
    await compensateCatalogProductVariantProfiles(catalogService, result)
  }
)

export const mutateCatalogProductVariantProfilesWorkflow = createWorkflow(
  {
    name: "mutate-catalog-product-variant-profiles",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  (input: VariantBatchWorkflowInput) =>
    new WorkflowResponse(mutateCatalogProductVariantProfilesStep(input))
)

const resolveCatalogProductInventoryLevelsStep = createStep(
  "resolve-catalog-product-inventory-levels",
  async (
    input: InventoryResolutionInput,
    { container }
  ): Promise<
    StepResponse<
      Awaited<ReturnType<typeof resolveCatalogProductInventoryLevels>>
    >
  > =>
    new StepResponse(
      await resolveCatalogProductInventoryLevels(
        container,
        input.command,
        input.context,
        input.created
      )
    )
)

const completeCatalogProductCreationStep = createStep(
  "complete-catalog-product-creation",
  async (
    input: CompletionInput,
    { container }
  ): Promise<StepResponse<CatalogProductCreateWorkflowResult>> => {
    if (input.operation.replayed) {
      if (!input.operation.result) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The replayed catalog creation command has no result."
        )
      }
      return new StepResponse({ ...input.operation.result, replayed: true })
    }
    if (!input.created || !input.profile || !input.variants) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not complete every required authoring step."
      )
    }
    if (input.command.media.length && !input.media) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not link its managed media."
      )
    }
    if (
      (input.command.kind === "fixed_bundle" ||
        input.command.kind === "mystery_bundle") &&
      !input.bundle
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not complete its bundle."
      )
    }
    if (input.command.kind === "fixed_bundle" && !input.managedInventory) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not enable component inventory."
      )
    }
    const result: CatalogProductCreateResult = {
      kind: input.command.kind,
      productId: input.created.productId,
      profileId: input.profile.profileId,
      variantIds: input.variants.variantIds,
    }
    const catalogService = container.resolve<CatalogService>("catalog")
    await completeCatalogProductCreation(
      catalogService,
      input.operation.operationId,
      result,
      [
        {
          operationId: input.profile.operationId,
          result: input.profile.result,
        },
        ...input.variants.completions,
        ...(input.media
          ? [
              {
                operationId: input.media.operationId,
                result: input.media.result,
              },
            ]
          : []),
        ...(input.bundle
          ? [
              {
                operationId: input.bundle.operationId,
                result: input.bundle.result,
              },
            ]
          : []),
      ]
    )
    if (input.mediaLease)
      await releaseCommittedCatalogMediaLease(container, input.mediaLease)
    return new StepResponse({ ...result, replayed: false })
  }
)

export const createCatalogProductWorkflow = createWorkflow(
  {
    name: "create-catalog-product",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 120,
  },
  (input: CatalogProductCreateCommandInput) => {
    const lockKey = transform(
      { idempotencyKey: input.idempotencyKey },
      ({ idempotencyKey }) => `catalog:product-create:${idempotencyKey}`
    )
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 180 })
    const operation = beginCatalogProductCreationStep(input)

    const context = when(
      "resolve-new-catalog-product-context",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() => resolveCatalogProductCreateContextStep(input))

    const products = when(
      "create-native-catalog-product",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() => {
      const nativeInput = transform(
        { command: input, context },
        ({ command, context }) => ({
          products: [buildCatalogNativeProduct(command, context!)],
        })
      )
      return createProductsWorkflow.runAsStep({ input: nativeInput })
    })

    const created = when(
      "resolve-new-catalog-product",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() =>
      resolveCatalogCreatedProductStep({ command: input, products: products! })
    )

    const mediaLease = when(
      "lease-new-catalog-product-media",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() =>
      resolveCreatedMediaLeaseStep({
        command: input,
        created: created!,
      })
    )
    // In the installed SDK, when().then applies .if after .config and restores
    // the original acquire-lock-step compensation closure. Keep this renamed
    // native step outside when so rollback reads its own saved keys and UUID.
    acquireLockStep({
      key: transform(
        { mediaLease },
        ({ mediaLease }) => mediaLease?.keys ?? []
      ),
      ownerId: transform(
        { mediaLease },
        ({ mediaLease }) => mediaLease?.ownerId
      ),
      timeout: 10,
      ttl: CATALOG_MEDIA_LEASE_SECONDS,
    }).config({ name: "acquire-created-catalog-media-lease" })

    const profile = when(
      "create-new-catalog-product-profile",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() => {
      const profileInput = transform(
        { command: input, created, mediaLease },
        ({ command, created }) =>
          buildCatalogProductProfileMutation(command, created!.productId)
      )
      return mutateCatalogProductProfileWorkflow.runAsStep({
        input: profileInput,
      })
    })

    const variants = when(
      "create-new-catalog-variant-profiles",
      { operation },
      ({ operation }) => !operation.replayed
    ).then(() => {
      const variantInput = transform(
        { command: input, created, profile },
        ({ command, created, profile }) => ({
          command,
          created: created!,
          productProfileId: profile!.profileId,
        })
      )
      return mutateCatalogProductVariantProfilesWorkflow.runAsStep({
        input: variantInput,
      })
    })

    const media = when(
      "create-new-catalog-product-media",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed && command.media.length > 0
    ).then(() => {
      const mediaInput = transform(
        { command: input, created, profile, mediaLease },
        ({ command, created, profile, mediaLease }) => ({
          ...buildCatalogProductMediaMutation(
            command,
            created!.productId,
            profile!.profileId
          ),
          inheritedMediaLease: mediaLease!,
        })
      )
      return mutateCatalogProductMediaWorkflow.runAsStep({ input: mediaInput })
    })

    const bundle = when(
      "create-new-catalog-bundle-profile",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed &&
        (command.kind === "fixed_bundle" || command.kind === "mystery_bundle")
    ).then(() => {
      const bundleInput = transform(
        { command: input, context, created, profile },
        ({
          command,
          context,
          created,
          profile,
        }): ReturnType<typeof buildCatalogBundleMutation> =>
          buildCatalogBundleMutation(
            command,
            context!,
            created!,
            created!.productId,
            profile!.profileId
          )
      )
      return mutateCatalogBundleWorkflow.runAsStep({ input: bundleInput })
    })

    const inventory = when(
      "create-new-catalog-product-inventory",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed && command.kind !== "fixed_bundle"
    ).then(() => {
      const inventoryLevels = resolveCatalogProductInventoryLevelsStep({
        command: input,
        context: context!,
        created: created!,
      })
      const inventoryInput = transform(
        { inventoryLevels },
        ({ inventoryLevels }) => ({ inventory_levels: inventoryLevels })
      )
      return createInventoryLevelsWorkflow.runAsStep({ input: inventoryInput })
    })

    const managedInventory = when(
      "enable-new-fixed-bundle-inventory",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed && command.kind === "fixed_bundle"
    ).then(() => {
      const variantInput = transform(
        { created, bundle },
        ({ created, bundle }) => {
          if (!bundle?.profileId) {
            throw new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              "The new bundle inventory has no confirmed profile."
            )
          }
          return {
            product_variants: created!.targets.map((target) => ({
              id: target.variantId,
              manage_inventory: true,
            })),
          }
        }
      )
      return updateProductVariantsWorkflow.runAsStep({ input: variantInput })
    })

    // The separate creation key may fail before commitment; the Product-media
    // lease remains held through child rollback and final audit persistence.
    releaseLockStep({ key: lockKey })
    const completed = completeCatalogProductCreationStep({
      bundle,
      command: input,
      created,
      inventory,
      managedInventory,
      media,
      mediaLease,
      operation,
      profile,
      variants,
    })
    return new WorkflowResponse(completed)
  }
)
