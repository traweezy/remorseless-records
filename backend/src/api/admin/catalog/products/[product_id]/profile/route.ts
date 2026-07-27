import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  catalogProductProfileUpsertSchema,
  resolveCatalogProductProfile,
  serializeCatalogProductProfileResponse,
} from "@/lib/catalog/product-profile-authoring"
import type { CatalogService } from "@/lib/catalog/reference-resolution"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import { mutateCatalogProductProfileWorkflow } from "@/workflows/catalog/mutate-product-profile"
import { assertProductExists } from "../../../utils"

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

const actorIdFromRequest = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const productId = productIdFromRequest(req)
  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveCatalogProductProfile(
    catalogService,
    productId,
  )
  res
    .status(200)
    .json(
      await serializeCatalogProductProfileResponse(catalogService, profile),
    )
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const productId = productIdFromRequest(req)
  const parsed = catalogProductProfileUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product profile payload.",
    )
  }

  await assertProductExists(req, productId)
  const {
    expectedVersion,
    idempotencyKey,
    ...patch
  } = parsed.data
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.product-profile.upsert" as const,
    expectedVersion,
    patch,
  }
  const { result } = await mutateCatalogProductProfileWorkflow(req.scope).run({
    context: {
      idempotencyKey,
      requestId: idempotencyKey,
    },
    input: {
      ...commandPayload,
      actorId: actorIdFromRequest(req),
      idempotencyKey,
      requestSha256: hashCatalogCommand(commandPayload),
    },
  })

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const refreshed = await resolveCatalogProductProfile(
    catalogService,
    productId,
  )
  res
    .status(result.created ? 201 : 200)
    .json(
      await serializeCatalogProductProfileResponse(catalogService, refreshed),
    )
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const productId = productIdFromRequest(req)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.runCatalogTransaction(async (sharedContext) => {
    const profile = await resolveCatalogProductProfile(
      catalogService,
      productId,
      sharedContext,
    )
    if (!profile) {
      return
    }

    const [
      artists,
      references,
      variantProfiles,
      bundleProfiles,
      mediaItems,
      shelfProducts,
    ] = await Promise.all([
      catalogService.listCatalogProductArtists(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
      catalogService.listCatalogProductReferences(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
      catalogService.listCatalogVariantProfiles(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
      catalogService.listCatalogBundleProfiles(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
      catalogService.listCatalogProductMediaItems(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
      catalogService.listCatalogShelfProducts(
        { product_profile_id: profile.id },
        {},
        sharedContext,
      ),
    ])
    if (artists.length) {
      await catalogService.deleteCatalogProductArtists(
        artists.map(({ id }) => id),
        sharedContext,
      )
    }
    if (references.length) {
      await catalogService.deleteCatalogProductReferences(
        references.map(({ id }) => id),
        sharedContext,
      )
    }
    await Promise.all([
      variantProfiles.length
        ? catalogService.updateCatalogVariantProfiles(
            variantProfiles.map(({ id }) => ({
              id,
              product_profile_id: null,
            })),
            sharedContext,
          )
        : Promise.resolve([]),
      bundleProfiles.length
        ? catalogService.updateCatalogBundleProfiles(
            bundleProfiles.map(({ id }) => ({
              id,
              product_profile_id: null,
            })),
            sharedContext,
          )
        : Promise.resolve([]),
      mediaItems.length
        ? catalogService.updateCatalogProductMediaItems(
            mediaItems.map(({ id }) => ({
              id,
              product_profile_id: null,
            })),
            sharedContext,
          )
        : Promise.resolve([]),
      shelfProducts.length
        ? catalogService.updateCatalogShelfProducts(
            shelfProducts.map(({ id }) => ({
              id,
              product_profile_id: null,
            })),
            sharedContext,
          )
        : Promise.resolve([]),
    ])
    await catalogService.deleteCatalogProductProfiles(
      profile.id,
      sharedContext,
    )
  })
  res.sendStatus(204)
}
