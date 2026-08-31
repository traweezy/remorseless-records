import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  loadDiscographyProductLinks,
  type DiscographyProductReader,
} from "@/lib/discography/product-links"
import { readAdminDiscographyEntry } from "@/lib/content/persistence-contracts"
import type DiscographyModuleService from "@/modules/discography/service"
import { serializeDiscographyEntry } from "@/modules/discography/serializers"
import {
  manualDiscographyUpdateSchema,
  updateManualDiscographyEntry,
} from "../helpers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }
  const discographyService =
    req.scope.resolve<DiscographyService>("discography")
  const entry = readAdminDiscographyEntry(
    await discographyService.retrieveDiscographyEntry(id),
    id
  )

  if (!entry) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Discography entry not found"
    )
  }

  const productService = req.scope.resolve<DiscographyProductReader>(
    Modules.PRODUCT
  )
  const productsById = await loadDiscographyProductLinks(productService, [
    entry,
  ])
  res.status(200).json({
    entry: serializeDiscographyEntry(
      entry,
      entry.source_mode === "catalog_product"
        ? {
            product: entry.product_id
              ? (productsById.get(entry.product_id) ?? null)
              : null,
          }
        : {}
    ),
  })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = manualDiscographyUpdateSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography payload"
    )
  }

  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }

  const service = req.scope.resolve<DiscographyService>("discography")
  const result = await updateManualDiscographyEntry(
    req,
    service,
    id,
    parsed.data
  )
  res.status(200).json(result)
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Discography entry id is required"
    )
  }
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Hard deletion is disabled. Archive the discography entry instead."
  )
}
