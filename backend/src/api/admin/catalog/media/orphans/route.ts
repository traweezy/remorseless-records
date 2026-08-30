import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  serializeCatalogMediaAsset,
  type CatalogMediaAssetRecord,
} from "@/modules/catalog/serializers"
import type { CatalogService } from "../../utils"

const querySchema = z.object({
  lifecycleStatus: z.enum(["active", "quarantined"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

const firstQueryValue = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value

const parseQuery = (
  query: MedusaRequest["query"]
): z.infer<typeof querySchema> => {
  const parsed = querySchema.safeParse({
    lifecycleStatus: firstQueryValue(query?.lifecycleStatus),
    limit: firstQueryValue(query?.limit),
    offset: firstQueryValue(query?.offset),
  })
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog media orphan query."
    )
  }
  return parsed.data
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const startedAt = performance.now()
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const query = parseQuery(req.query)
  const page = await catalogService.listOrphanCatalogMediaAssets({
    ...(query.lifecycleStatus
      ? { lifecycleStatus: query.lifecycleStatus }
      : {}),
    limit: query.limit,
    offset: query.offset,
  })
  const assets = page.rows as unknown as CatalogMediaAssetRecord[]

  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader(
    "Server-Timing",
    `catalog-media-orphans;dur=${Math.round(performance.now() - startedAt)}`
  )
  res.status(200).json({
    count: page.count,
    assets: assets.map(serializeCatalogMediaAsset),
    hasMore: query.offset + assets.length < page.count,
    limit: query.limit,
    offset: query.offset,
  })
}
