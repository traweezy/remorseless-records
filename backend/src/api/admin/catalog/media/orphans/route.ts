import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { serializeCatalogMediaAsset } from "@/modules/catalog/serializers"
import { readCatalogOrphanMediaPage } from "@/lib/catalog/persistence-contracts"
import { readCatalogMediaAssets } from "@/lib/catalog/transaction-persistence-contracts"
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
  const catalogService = req.scope.resolve<CatalogService>("catalog")
  const query = parseQuery(req.query)
  const page = await catalogService.listOrphanCatalogMediaAssets({
    ...(query.lifecycleStatus
      ? { lifecycleStatus: query.lifecycleStatus }
      : {}),
    limit: query.limit,
    offset: query.offset,
  })
  const validatedPage = readCatalogOrphanMediaPage(
    [{ count: page.count }],
    page.rows
  )
  const assets = readCatalogMediaAssets(validatedPage.rows, {
    ...(query.lifecycleStatus === undefined
      ? {}
      : { expectedLifecycleStatus: query.lifecycleStatus }),
    maximumRows: query.limit,
  })

  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader(
    "Server-Timing",
    `catalog-media-orphans;dur=${Math.round(performance.now() - startedAt)}`
  )
  res.status(200).json({
    count: validatedPage.count,
    assets: assets.map(serializeCatalogMediaAsset),
    hasMore: query.offset + assets.length < validatedPage.count,
    limit: query.limit,
    offset: query.offset,
  })
}
