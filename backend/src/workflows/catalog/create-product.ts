import {
  acquireLockStep,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  releaseLockStep,
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
import type CatalogModuleService from "@/modules/catalog/service"
import { mutateCatalogBundleWorkflow } from "./mutate-bundle"
import { mutateCatalogProductMediaWorkflow } from "./mutate-product-media"
import { mutateCatalogProductProfileWorkflow } from "./mutate-product-profile"

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
  bundle: unknown
  command: CatalogProductCreateCommandInput
  created: CatalogCreatedProduct | undefined
  inventory: unknown
  media: unknown
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
    { container },
  ): Promise<
    StepResponse<
      CatalogProductCreateOperation,
      CreationOperationCompensation | null
    >
  > => {
    const catalogService = container.resolve("catalog") as CatalogService
    const operation = await beginCatalogProductCreation(catalogService, input)
    return new StepResponse(
      operation,
      operation.replayed ? null : { operationId: operation.operationId },
    )
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const catalogService = container.resolve("catalog") as CatalogService
    await compensateCatalogProductCreation(
      catalogService,
      compensation.operationId,
    )
  },
)

const resolveCatalogProductCreateContextStep = createStep(
  "resolve-catalog-product-create-context",
  async (
    input: CatalogProductCreateCommandInput,
    { container },
  ): Promise<StepResponse<CatalogProductCreateContext>> =>
    new StepResponse(
      await resolveCatalogProductCreateContext(container, input),
    ),
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
    { container },
  ): Promise<StepResponse<CatalogCreatedProduct>> =>
    new StepResponse(
      await resolveCatalogCreatedProduct(container, command, products),
    ),
)

const mutateCatalogProductVariantProfilesStep = createStep(
  "mutate-catalog-product-variant-profiles-batch",
  async (
    input: VariantBatchWorkflowInput,
    { container },
  ): Promise<
    StepResponse<
      CatalogProductVariantBatchResult,
      CatalogProductVariantBatchResult
    >
  > => {
    const catalogService = container.resolve("catalog") as CatalogService
    const result = await mutateCatalogProductVariantProfiles(
      catalogService,
      input.command,
      input.created.productId,
      input.productProfileId,
      input.created.targets,
    )
    return new StepResponse(result, result)
  },
  async (result, { container }) => {
    if (!result) {
      return
    }
    const catalogService = container.resolve("catalog") as CatalogService
    await compensateCatalogProductVariantProfiles(catalogService, result)
  },
)

export const mutateCatalogProductVariantProfilesWorkflow = createWorkflow(
  {
    name: "mutate-catalog-product-variant-profiles",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 60,
  },
  function (input: VariantBatchWorkflowInput) {
    return new WorkflowResponse(
      mutateCatalogProductVariantProfilesStep(input),
    )
  },
)

const resolveCatalogProductInventoryLevelsStep = createStep(
  "resolve-catalog-product-inventory-levels",
  async (
    input: InventoryResolutionInput,
    { container },
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
        input.created,
      ),
    ),
)

const completeCatalogProductCreationStep = createStep(
  "complete-catalog-product-creation",
  async (
    input: CompletionInput,
    { container },
  ): Promise<StepResponse<CatalogProductCreateWorkflowResult>> => {
    if (input.operation.replayed) {
      if (!input.operation.result) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The replayed catalog creation command has no result.",
        )
      }
      return new StepResponse({ ...input.operation.result, replayed: true })
    }
    if (!input.created || !input.profile || !input.variants) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not complete every required authoring step.",
      )
    }
    if (input.command.media.length && !input.media) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog creation workflow did not link its managed media.",
      )
    }
    const result: CatalogProductCreateResult = {
      kind: input.command.kind,
      productId: input.created.productId,
      profileId: input.profile.profileId,
      variantIds: input.variants.variantIds,
    }
    const catalogService = container.resolve("catalog") as CatalogService
    await completeCatalogProductCreation(
      catalogService,
      input.operation.operationId,
      result,
    )
    return new StepResponse({ ...result, replayed: false })
  },
)

export const createCatalogProductWorkflow = createWorkflow(
  {
    name: "create-catalog-product",
    retentionTime: 60 * 60 * 24 * 30,
    store: true,
    timeout: 120,
  },
  function (input: CatalogProductCreateCommandInput) {
    const lockKey = transform(
      { idempotencyKey: input.idempotencyKey },
      ({ idempotencyKey }) => `catalog:product-create:${idempotencyKey}`,
    )
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 180 })
    const operation = beginCatalogProductCreationStep(input)

    const context = when(
      "resolve-new-catalog-product-context",
      { operation },
      ({ operation }) => !operation.replayed,
    ).then(() => resolveCatalogProductCreateContextStep(input))

    const products = when(
      "create-native-catalog-product",
      { operation },
      ({ operation }) => !operation.replayed,
    ).then(() => {
      const nativeInput = transform(
        { command: input, context },
        ({ command, context }) => ({
          products: [buildCatalogNativeProduct(command, context!)],
        }),
      )
      return createProductsWorkflow.runAsStep({ input: nativeInput })
    })

    const created = when(
      "resolve-new-catalog-product",
      { operation },
      ({ operation }) => !operation.replayed,
    ).then(() =>
      resolveCatalogCreatedProductStep({ command: input, products: products! }),
    )

    const profile = when(
      "create-new-catalog-product-profile",
      { operation },
      ({ operation }) => !operation.replayed,
    ).then(() => {
      const profileInput = transform(
        { command: input, created },
        ({ command, created }) =>
          buildCatalogProductProfileMutation(command, created!.productId),
      )
      return mutateCatalogProductProfileWorkflow.runAsStep({
        input: profileInput,
      })
    })

    const variants = when(
      "create-new-catalog-variant-profiles",
      { operation },
      ({ operation }) => !operation.replayed,
    ).then(() => {
      const variantInput = transform(
        { command: input, created, profile },
        ({ command, created, profile }) => ({
          command,
          created: created!,
          productProfileId: profile!.profileId,
        }),
      )
      return mutateCatalogProductVariantProfilesWorkflow.runAsStep({
        input: variantInput,
      })
    })

    const media = when(
      "create-new-catalog-product-media",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed && command.media.length > 0,
    ).then(() => {
      const mediaInput = transform(
        { command: input, created, profile },
        ({ command, created, profile }) =>
          buildCatalogProductMediaMutation(
            command,
            created!.productId,
            profile!.profileId,
          ),
      )
      return mutateCatalogProductMediaWorkflow.runAsStep({ input: mediaInput })
    })

    const bundle = when(
      "create-new-catalog-bundle-profile",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed &&
        (command.kind === "fixed_bundle" ||
          command.kind === "mystery_bundle"),
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
            profile!.profileId,
          ),
      )
      return mutateCatalogBundleWorkflow.runAsStep({ input: bundleInput })
    })

    const inventory = when(
      "create-new-catalog-product-inventory",
      { command: input, operation },
      ({ command, operation }) =>
        !operation.replayed && command.kind !== "fixed_bundle",
    ).then(() => {
      const inventoryLevels = resolveCatalogProductInventoryLevelsStep({
        command: input,
        context: context!,
        created: created!,
      })
      const inventoryInput = transform(
        { inventoryLevels },
        ({ inventoryLevels }) => ({ inventory_levels: inventoryLevels }),
      )
      return createInventoryLevelsWorkflow.runAsStep({ input: inventoryInput })
    })

    const completed = completeCatalogProductCreationStep({
      bundle,
      command: input,
      created,
      inventory,
      media,
      operation,
      profile,
      variants,
    })
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(completed)
  },
)
