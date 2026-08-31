import type { FileTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"

import {
  CatalogMediaUploadPartialFailure,
  compensateCatalogMediaUpload,
  performCatalogMediaUpload,
  type CatalogMediaUploadInput,
  type CatalogMediaUploadMutationResult,
} from "@/lib/catalog/product-media-upload"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

export type CatalogMediaUploadWorkflowInput = CatalogMediaUploadInput

const uploadCatalogMediaStep = createStep(
  "upload-catalog-product-media",
  async (
    input: CatalogMediaUploadWorkflowInput,
    { container }
  ): Promise<
    StepResponse<
      CatalogMediaUploadMutationResult,
      Awaited<ReturnType<typeof performCatalogMediaUpload>>["compensation"]
    >
  > => {
    const catalogService = container.resolve<CatalogService>("catalog")
    const fileService = container.resolve<FileTypes.IFileModuleService>(
      Modules.FILE
    )
    try {
      const result = await performCatalogMediaUpload(
        catalogService,
        fileService,
        input
      )
      return new StepResponse(result.mutation, result.compensation)
    } catch (error) {
      if (error instanceof CatalogMediaUploadPartialFailure) {
        return StepResponse.permanentFailure(error.message, error.compensation)
      }
      throw error
    }
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const catalogService = container.resolve<CatalogService>("catalog")
    const fileService = container.resolve<FileTypes.IFileModuleService>(
      Modules.FILE
    )
    await compensateCatalogMediaUpload(
      catalogService,
      fileService,
      compensation
    )
  }
)

const completeCatalogMediaUploadStep = createStep(
  "complete-catalog-product-media-upload",
  async (
    mutation: CatalogMediaUploadMutationResult,
    { container }
  ): Promise<StepResponse<CatalogMediaUploadMutationResult>> => {
    if (!mutation.replayed) {
      const catalogService = container.resolve<CatalogService>("catalog")
      await catalogService.completeCatalogAuthoringOperation(
        mutation.operationId,
        { files: mutation.files }
      )
    }
    return new StepResponse(mutation)
  }
)

export const uploadCatalogProductMediaWorkflow = createWorkflow(
  {
    name: "upload-catalog-product-media",
    store: false,
    timeout: 120,
  },
  (input: CatalogMediaUploadWorkflowInput) => {
    const lockKey = transform(
      { idempotencyKey: input.idempotencyKey },
      ({ idempotencyKey }) => `catalog:media-upload:${idempotencyKey}`
    )
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 180 })
    const uploaded = uploadCatalogMediaStep(input)
    const completed = completeCatalogMediaUploadStep(uploaded)
    releaseLockStep({ key: lockKey })
    return new WorkflowResponse(completed)
  }
)
