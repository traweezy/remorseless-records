import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  loadDiscographyProductLinks,
  type DiscographyProductReader,
} from "@/lib/discography/product-links"
import type DiscographyModuleService from "@/modules/discography/service"
import { withStableDiscographyOrder } from "@/modules/discography/list-order"
import {
  discographySourceModeValues,
  discographyAvailabilityValues,
  type DiscographyEntryRecord,
  serializeDiscographyEntry,
} from "@/modules/discography/serializers"
import {
  createManualDiscographyEntry,
  manualDiscographyCreateSchema,
} from "./helpers"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

const listQuerySchema = z.object({
  archived: z.enum(["active", "archived", "all"]).optional(),
  availability: z.enum(discographyAvailabilityValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(200).optional(),
  order: z
    .enum([
      "artist",
      "created_at",
      "release_date",
      "release_year",
      "title",
      "updated_at",
    ])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  sourceMode: z.enum(discographySourceModeValues).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography list query"
    )
  }
  const {
    archived = "active",
    availability,
    direction,
    limit,
    offset,
    order,
    q,
    sourceMode,
  } = parsed.data
  const discographyService = req.scope.resolve(
    "discography"
  ) as DiscographyService
  const productService = req.scope.resolve(
    Modules.PRODUCT
  ) as DiscographyProductReader

  const take = limit ?? 25
  const skip = offset ?? 0
  const sortField = order ?? "release_year"
  const sortDirection = (direction ?? "desc").toUpperCase() as "ASC" | "DESC"
  const filters: Record<string, unknown> = {}
  if (q) filters.q = q
  if (availability) filters.availability = availability
  if (sourceMode) filters.source_mode = sourceMode
  if (archived === "active") filters.archived_at = null
  if (archived === "archived") filters.archived_at = { $ne: null }

  const [entries, count] =
    await discographyService.listAndCountDiscographyEntries(filters, {
      skip,
      take,
      order: withStableDiscographyOrder({ [sortField]: sortDirection }),
    })
  const records = entries as DiscographyEntryRecord[]
  const productsById = await loadDiscographyProductLinks(
    productService,
    records
  )

  res.status(200).json({
    entries: records.map((entry) =>
      serializeDiscographyEntry(
        entry,
        entry.source_mode === "catalog_product"
          ? {
              product: entry.product_id
                ? (productsById.get(entry.product_id) ?? null)
                : null,
            }
          : {}
      )
    ),
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = manualDiscographyCreateSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid discography payload"
    )
  }

  const service = req.scope.resolve("discography") as DiscographyService
  const result = await createManualDiscographyEntry(req, service, parsed.data)
  res.status(result.replayed ? 200 : 201).json(result)
}
