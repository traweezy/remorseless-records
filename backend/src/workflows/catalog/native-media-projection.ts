import type { IProductModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  projectNativeCatalogMedia,
  restoreNativeCatalogMediaProjection,
  type NativeMediaProjectionPlan,
  type NativeMediaProjectionSnapshot,
} from "@/lib/catalog/native-media-projection"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>

export const projectNativeMediaStep = createStep(
  "project-native-catalog-product-media",
  async (
    {
      mutation,
      plan,
    }: {
      mutation: { replayed: boolean }
      plan: NativeMediaProjectionPlan | null
    },
    { container, eventGroupId }
  ): Promise<
    StepResponse<
      NativeMediaProjectionSnapshot | null,
      NativeMediaProjectionSnapshot | null
    >
  > => {
    if (mutation.replayed) return new StepResponse(null, null)
    if (!plan)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media projection plan is unavailable."
      )
    if (!eventGroupId)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media event group is unavailable."
      )
    const snapshot = await projectNativeCatalogMedia(
      container.resolve<IProductModuleService>(Modules.PRODUCT),
      container.resolve<CatalogService>("catalog"),
      plan,
      { eventGroupId }
    )
    return new StepResponse(snapshot, snapshot)
  },
  async (snapshot, { container, eventGroupId }) => {
    if (!snapshot) return
    if (!eventGroupId)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media event group is unavailable."
      )
    await restoreNativeCatalogMediaProjection(
      container.resolve<IProductModuleService>(Modules.PRODUCT),
      snapshot,
      { eventGroupId }
    )
  }
)
