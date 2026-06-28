import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  catalogBundleTypeValues,
  serializeCatalogBundleProfile,
} from "@/modules/catalog/serializers"
import type { CatalogService } from "../utils"
import {
  bundleUpsertSchema,
  loadBundleComponents,
  upsertBundleForProduct,
} from "./helpers"

const bundleListQuerySchema = z.object({
  productId: z.string().trim().optional(),
  bundleType: z.enum(catalogBundleTypeValues).optional(),
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const bundleCreateSchema = bundleUpsertSchema.extend({
  productId: z.string().trim().min(1),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { productId, bundleType, active, limit, offset } =
    bundleListQuerySchema.parse(req.query)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const take = limit ?? 100
  const skip = offset ?? 0
  const filters: Record<string, unknown> = {}
  if (productId) {
    filters.product_id = productId
  }
  if (bundleType) {
    filters.bundle_type = bundleType
  }
  if (active !== undefined) {
    filters.is_active = active
  }

  const [bundles, count] = await catalogService.listAndCountCatalogBundleProfiles(
    filters,
    {
      skip,
      take,
      order: { created_at: "DESC" },
    }
  )
  const serialized = await Promise.all(
    bundles.map(async (bundle) => ({
      bundle: serializeCatalogBundleProfile(bundle),
      components: await loadBundleComponents(catalogService, bundle.id),
    }))
  )

  res.status(200).json({
    bundles: serialized,
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = bundleCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog bundle payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const { productId, ...input } = parsed.data
  const result = await upsertBundleForProduct(
    req,
    catalogService,
    productId,
    input
  )
  res.status(result.status).json(result.body)
}
