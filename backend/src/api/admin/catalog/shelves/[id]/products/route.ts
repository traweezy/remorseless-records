import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type { CatalogService } from "../../../utils"
import {
  loadShelfProducts,
  replaceShelfProducts,
  resolveShelf,
  shelfProductInputSchema,
} from "../../helpers"
import { emitCatalogShelfChanged } from "../../events"

const shelfProductsSchema = z.object({
  products: z.array(shelfProductInputSchema).max(200),
})

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
  res.status(200).json({
    shelfId: shelf.id,
    products: await loadShelfProducts(catalogService, shelf.id),
  })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = shelfProductsSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog shelf products payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const shelf = await resolveShelf(catalogService, getShelfId(req))
  await replaceShelfProducts(req, catalogService, shelf.id, parsed.data.products)
  await emitCatalogShelfChanged(req, shelf.id)
  res.status(200).json({
    shelfId: shelf.id,
    products: await loadShelfProducts(catalogService, shelf.id),
  })
}
