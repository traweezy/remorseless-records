import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import type CatalogModuleService from "@/modules/catalog/service"
import {
  loadStoreCatalogPresentations,
  STORE_PRESENTATION_PAGE_LIMIT,
} from "@/lib/catalog/store-presentation"
import {
  listVisibleProductsByIds,
  resolveStoreProductVisibility,
} from "@/lib/store-product-visibility"

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const raw = req.query.product_ids
  const ids =
    typeof raw === "string" && raw.length <= 6_400 ? raw.split(",") : []
  if (
    !ids.length ||
    ids.length > STORE_PRESENTATION_PAGE_LIMIT ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^prod_[A-Za-z0-9_-]{1,249}$/u.test(id))
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Supply up to 25 distinct product IDs"
    )
  }
  const { query, salesChannelIds } = resolveStoreProductVisibility(req)
  const visible = await listVisibleProductsByIds({
    query,
    salesChannelIds,
    productIds: ids,
    fields: ["id"],
    decodeProduct: (row) => ({ id: String(row.id) }),
  })
  // No custom read occurs before publication and key-channel visibility pass.
  const presentations = visible.length
    ? await loadStoreCatalogPresentations(
        req.scope.resolve<InstanceType<typeof CatalogModuleService>>("catalog"),
        visible.map((product) => product.id)
      )
    : []
  res.setHeader("Vary", "x-publishable-api-key")
  res.setHeader("Cache-Control", "private, no-store")
  res.status(200).json({ presentations })
}
