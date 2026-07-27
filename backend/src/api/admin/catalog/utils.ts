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
  }) => Promise<{ data: Array<Record<string, unknown>> }>
}

export const resolveUniqueSlug = async (
  catalogService: CatalogService,
  baseSlug: string,
  excludeId?: string
): Promise<string> => {
  const normalizedBase = baseSlug.trim() || "catalog"
  let candidate = normalizedBase
  let suffix = 1

  while (suffix < 50) {
    const existing = await catalogService.listCatalogArtists({ slug: candidate })
    const collision = existing.find((artist) => artist.id !== excludeId)
    if (!collision) {
      return candidate
    }
    candidate = `${normalizedBase}-${suffix}`
    suffix += 1
  }

  return `${normalizedBase}-${Date.now()}`
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

  if (!result.data.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, message)
  }
}

export const assertProductExists = async (
  req: MedusaRequest,
  productId: string
): Promise<void> => {
  await assertQueryEntityExists(req, "product", productId, "Product not found")
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

  const variant = result.data.at(0)
  if (!variant) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Product variant not found"
    )
  }

  const variantProductId =
    typeof variant.product_id === "string"
      ? variant.product_id
      : variant.product &&
          typeof variant.product === "object" &&
          "id" in variant.product &&
          typeof variant.product.id === "string"
        ? variant.product.id
        : null

  if (variantProductId !== productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      message
    )
  }
}
