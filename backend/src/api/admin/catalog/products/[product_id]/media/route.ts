import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogProductMediaReplaceSchema,
  loadCatalogProductMediaResponse,
} from "@/lib/catalog/product-media-authoring"
import { listProductMediaItems } from "@/lib/catalog/product-media-read"
import { toCatalogNullableString } from "@/lib/catalog/normalization"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { mutateCatalogProductMediaWorkflow } from "../../../../../../workflows/catalog/mutate-product-media"
import {
  assertProductExists,
  assertVariantBelongsToProduct,
  type CatalogService,
} from "../../../utils"

const productIdFromRequest = (req: MedusaRequest): string => {
  const productId = req.params.product_id?.trim()
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required.",
    )
  }
  return productId
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const productId = productIdFromRequest(req)
  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  res
    .status(200)
    .json(await loadCatalogProductMediaResponse(catalogService, productId))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const parsed = catalogProductMediaReplaceSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product media payload.",
    )
  }
  const productId = productIdFromRequest(req)
  await assertProductExists(req, productId)
  for (const input of parsed.data.media) {
    const variantId = toCatalogNullableString(input.variantId)
    if (variantId) {
      await assertVariantBelongsToProduct(req, productId, variantId)
    }
  }

  const actorId =
    (
      req as MedusaRequest & {
        auth_context?: { actor_id?: string | null }
      }
    ).auth_context?.actor_id ?? null
  const {
    expectedVersion,
    idempotencyKey,
    media,
  } = parsed.data
  const requestSha256 = hashCatalogCommand({
    command: "catalog.product-media.replace",
    expectedVersion,
    media,
    productId,
  })
  await mutateCatalogProductMediaWorkflow(req.scope).run({
    context: {
      idempotencyKey,
      requestId: idempotencyKey,
    },
    input: {
      actorId,
      aggregateId: productId,
      command: "catalog.product-media.replace",
      expectedVersion,
      idempotencyKey,
      media,
      requestSha256,
    },
  })
  const catalogService = req.scope.resolve("catalog") as CatalogService
  res
    .status(200)
    .json(await loadCatalogProductMediaResponse(catalogService, productId))
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const productId = productIdFromRequest(req)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.runCatalogTransaction(async (sharedContext) => {
    const items = await listProductMediaItems(
      catalogService,
      productId,
      sharedContext,
    )
    if (items.length) {
      await catalogService.deleteCatalogProductMediaItems(
        items.map(({ id }) => id),
        sharedContext,
      )
    }
  })
  res.sendStatus(204)
}
