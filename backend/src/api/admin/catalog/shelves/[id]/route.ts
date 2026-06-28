import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import type { CatalogService } from "../../utils"
import {
  deleteShelf,
  resolveShelf,
  serializeShelfResponse,
  shelfUpsertSchema,
  upsertShelf,
} from "../helpers"

const getShelfId = (req: MedusaRequest): string => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog shelf id is required"
    )
  }

  return id
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const shelf = await resolveShelf(catalogService, getShelfId(req))
  res.status(200).json(await serializeShelfResponse(catalogService, shelf))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = shelfUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog shelf payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const result = await upsertShelf(
    req,
    catalogService,
    parsed.data,
    getShelfId(req)
  )
  res.status(result.status).json(result.body)
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const catalogService = req.scope.resolve("catalog") as CatalogService
  await deleteShelf(catalogService, getShelfId(req))
  res.sendStatus(204)
}
