import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys } from "@medusajs/utils"

import {
  coerceCatalogJsonList,
  coerceCatalogJsonRecord,
  firstCatalogResult,
  normalizeCatalogList,
  slugifyCatalogValue,
  toCatalogNullableString,
  toCatalogOptionalDate,
  toCatalogOptionalInteger,
} from "@/lib/catalog/normalization"
import { readCatalogArtistList } from "@/lib/catalog/profile-persistence-contracts"
import {
  readCatalogEntityIds,
  readCatalogVariantOwnerships,
} from "@/lib/catalog/persistence-contracts"
import {
  createOrReuseCatalogArtist,
  createOrReuseCatalogReferenceValue,
  type CatalogService,
} from "@/lib/catalog/reference-resolution"

export type { CatalogService }
export {
  coerceCatalogJsonList as coerceJsonList,
  coerceCatalogJsonRecord as coerceJsonRecord,
  createOrReuseCatalogArtist as createOrReuseArtist,
  createOrReuseCatalogReferenceValue as createOrReuseReferenceValue,
  firstCatalogResult as firstResult,
  normalizeCatalogList as normalizeList,
  slugifyCatalogValue as slugify,
  toCatalogNullableString as toNullableString,
  toCatalogOptionalDate as toOptionalDate,
  toCatalogOptionalInteger as toOptionalInteger,
}

type QueryGraph = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: {
      take?: number
      skip?: number
    }
  }) => Promise<unknown>
}

export const resolveUniqueSlug = async (
  catalogService: CatalogService,
  baseSlug: string,
  excludeId?: string
): Promise<string> => {
  const normalizedBase = baseSlug.trim() || "catalog"
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate =
      suffix === 0 ? normalizedBase : `${normalizedBase}-${suffix}`
    const existing = readCatalogArtistList(
      await catalogService.listCatalogArtists({ slug: candidate }, { take: 2 }),
      { expectedSlug: candidate, maximumRows: 1 }
    )
    const collision = existing.find((artist) => artist.id !== excludeId)
    if (!collision) {
      return candidate
    }
  }
  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    "Unable to allocate a unique artist slug. Choose a more specific slug."
  )
}

const getQuery = (req: MedusaRequest): QueryGraph =>
  req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

export const assertQueryEntityExists = async (
  req: MedusaRequest,
  entity: string,
  id: string,
  message: string
): Promise<void> => {
  const query = getQuery(req)
  const result = await query.graph({
    entity,
    fields: ["id"],
    filters: { id },
    pagination: { take: 1 },
  })

  const foundIds = readCatalogEntityIds(result, [id])
  if (!foundIds.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, message)
  }
}

export const assertProductExists = async (
  req: MedusaRequest,
  productId: string
): Promise<void> => {
  await assertQueryEntityExists(req, "product", productId, "Product not found")
}

export const assertProductsExist = async (
  req: MedusaRequest,
  productIds: readonly string[]
): Promise<void> => {
  const uniqueProductIds = [...new Set(productIds)]
  if (!uniqueProductIds.length) {
    return
  }

  const query = getQuery(req)
  const result = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: uniqueProductIds },
    pagination: { take: uniqueProductIds.length },
  })
  const found = new Set(readCatalogEntityIds(result, uniqueProductIds))
  const missing = uniqueProductIds.find((productId) => !found.has(productId))
  if (missing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product not found: ${missing}`
    )
  }
}

export const assertVariantExists = async (
  req: MedusaRequest,
  variantId: string
): Promise<void> => {
  await assertQueryEntityExists(
    req,
    "product_variant",
    variantId,
    "Product variant not found"
  )
}

export const assertVariantBelongsToProduct = async (
  req: MedusaRequest,
  productId: string,
  variantId: string,
  message = "Product variant must belong to the product"
): Promise<void> => {
  const query = getQuery(req)
  const result = await query.graph({
    entity: "product_variant",
    fields: ["id", "product_id", "product.id"],
    filters: { id: variantId },
    pagination: { take: 1 },
  })

  const variants = readCatalogVariantOwnerships(result, [variantId])
  const variant = variants[0]
  if (!variant) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Product variant not found"
    )
  }

  if (variant.productId !== productId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
}
