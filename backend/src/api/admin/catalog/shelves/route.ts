import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  catalogShelfAutomationTypeValues,
  catalogShelfModeValues,
  serializeCatalogShelf,
} from "@/modules/catalog/serializers"
import type { CatalogService } from "../utils"
import { loadShelfProducts, shelfUpsertSchema, upsertShelf } from "./helpers"

const shelfListQuerySchema = z.object({
  handle: z.string().trim().optional(),
  mode: z.enum(catalogShelfModeValues).optional(),
  automationType: z.enum(catalogShelfAutomationTypeValues).optional(),
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  ribbon: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { handle, mode, automationType, active, ribbon, limit, offset } =
    shelfListQuerySchema.parse(req.query)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const filters: Record<string, unknown> = {}
  if (handle) {
    filters.handle = handle
  }
  if (mode) {
    filters.mode = mode
  }
  if (automationType) {
    filters.automation_type = automationType
  }
  if (active !== undefined) {
    filters.is_active = active
  }
  if (ribbon !== undefined) {
    filters.show_ribbon = ribbon
  }

  const take = limit ?? 100
  const skip = offset ?? 0
  const [shelves, count] = await catalogService.listAndCountCatalogShelves(
    filters,
    {
      skip,
      take,
      order: { ribbon_priority: "ASC", created_at: "DESC" },
    }
  )
  const serialized = await Promise.all(
    shelves.map(async (shelf) => ({
      shelf: serializeCatalogShelf(shelf),
      products: await loadShelfProducts(catalogService, shelf.id),
    }))
  )

  res.status(200).json({
    shelves: serialized,
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
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
  const result = await upsertShelf(req, catalogService, parsed.data)
  res.status(result.status).json(result.body)
}
