import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys } from "@medusajs/utils"

import type CatalogModuleService from "@/modules/catalog/service"
import type {
  CatalogArtistRecord,
  CatalogReferenceKind,
  CatalogReferenceValueRecord,
  JsonList,
  JsonRecord,
} from "@/modules/catalog/serializers"

export type CatalogService = InstanceType<typeof CatalogModuleService>

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

export const slugify = (value: string, fallback = "catalog"): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")

  return normalized.length ? normalized : fallback
}

export const normalizeList = (values?: string[] | null): string[] =>
  (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)

export const toNullableString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export const toOptionalDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const toOptionalInteger = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null
  }
  return value
}

export const coerceJsonRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as JsonRecord
}

export const coerceJsonList = (value: unknown): JsonList =>
  Array.isArray(value) ? value : []

export const firstResult = <T>(value: T | T[]): T | undefined =>
  Array.isArray(value) ? value[0] : value

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
  variantId: string
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
      "Product media variant must belong to the product"
    )
  }
}

export const createOrReuseArtist = async (
  catalogService: CatalogService,
  input: {
    artistId?: string | null | undefined
    name?: string | null | undefined
    metadata?: JsonRecord
  }
): Promise<CatalogArtistRecord | null> => {
  const artistId = toNullableString(input.artistId)
  if (artistId) {
    return (await catalogService.retrieveCatalogArtist(
      artistId
    )) as CatalogArtistRecord
  }

  const name = toNullableString(input.name)
  if (!name) {
    return null
  }

  const slug = slugify(name, "artist")
  const existing = await catalogService.listCatalogArtists({ slug })
  const match = existing.at(0) as CatalogArtistRecord | undefined
  if (match) {
    return match
  }

  const created = await catalogService.createCatalogArtists([
    {
      name,
      slug,
      sort_name: name,
      metadata: input.metadata ?? {},
    },
  ])

  return firstResult(created) as CatalogArtistRecord | undefined ?? null
}

export const createOrReuseReferenceValue = async (
  catalogService: CatalogService,
  input: {
    referenceValueId?: string | null | undefined
    kind?: CatalogReferenceKind | null | undefined
    label?: string | null | undefined
    value?: string | null | undefined
    metadata?: JsonRecord
  }
): Promise<CatalogReferenceValueRecord | null> => {
  const referenceValueId = toNullableString(input.referenceValueId)
  if (referenceValueId) {
    return (await catalogService.retrieveCatalogReferenceValue(
      referenceValueId
    )) as CatalogReferenceValueRecord
  }

  const kind = input.kind ?? null
  const label = toNullableString(input.label)
  if (!kind || !label) {
    return null
  }

  const value = toNullableString(input.value) ?? slugify(label, kind)
  const existing = await catalogService.listCatalogReferenceValues({
    kind,
    value,
  })
  const match = existing.at(0) as CatalogReferenceValueRecord | undefined
  if (match) {
    return match
  }

  const created = await catalogService.createCatalogReferenceValues([
    {
      kind,
      label,
      value,
      rank: 0,
      is_active: true,
      metadata: input.metadata ?? {},
    },
  ])

  return firstResult(created) as CatalogReferenceValueRecord | undefined ?? null
}
