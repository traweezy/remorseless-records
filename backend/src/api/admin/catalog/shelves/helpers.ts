import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  catalogShelfAutomationTypeValues,
  catalogShelfModeValues,
  type CatalogShelfAutomationType,
  type CatalogShelfProductRecord,
  type CatalogShelfRecord,
  serializeCatalogShelf,
  serializeCatalogShelfProduct,
} from "@/modules/catalog/serializers"
import {
  assertProductExists,
  coerceJsonRecord,
  firstResult,
  slugify,
  toNullableString,
  toOptionalDate,
  type CatalogService,
} from "../utils"

export const shelfProductInputSchema = z.object({
  productId: z.string().trim().min(1),
  productProfileId: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isPinned: z.boolean().optional(),
  startsAt: z.string().trim().optional().nullable(),
  endsAt: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const shelfUpsertSchema = z.object({
  handle: z.string().trim().optional().nullable(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
  mode: z.enum(catalogShelfModeValues).optional(),
  automationType: z.enum(catalogShelfAutomationTypeValues).optional(),
  showRibbon: z.boolean().optional(),
  ribbonLabel: z.string().trim().optional().nullable(),
  ribbonPriority: z.number().int().min(0).optional(),
  productLimit: z.number().int().min(1).optional().nullable(),
  startsAt: z.string().trim().optional().nullable(),
  endsAt: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  products: z.array(shelfProductInputSchema).max(200).optional(),
})

export type ShelfUpsertInput = z.infer<typeof shelfUpsertSchema>
export type ShelfProductInput = z.infer<typeof shelfProductInputSchema>

type CatalogServiceMethod = (...args: unknown[]) => Promise<unknown>
type CatalogServiceMethods = Record<string, CatalogServiceMethod | undefined>
type ServiceQueryConfig = {
  skip?: number
  take?: number
  order?: Record<string, "ASC" | "DESC">
}

const callCatalogService = async <T>(
  catalogService: CatalogService,
  candidates: readonly string[],
  args: unknown[]
): Promise<T> => {
  const methods = catalogService as unknown as CatalogServiceMethods
  const methodName = candidates.find(
    (candidate) => typeof methods[candidate] === "function"
  )
  const method = methodName ? methods[methodName] : undefined

  if (!method) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Catalog service is missing ${candidates.join(" or ")}`
    )
  }

  return (await method.apply(catalogService, args)) as T
}

export const listCatalogShelves = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig
): Promise<CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord[]>(
    catalogService,
    ["listCatalogShelves", "listCatalogShelfs"],
    config ? [filters, config] : [filters]
  )

export const listAndCountCatalogShelves = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig
): Promise<[CatalogShelfRecord[], number]> =>
  callCatalogService<[CatalogShelfRecord[], number]>(
    catalogService,
    ["listAndCountCatalogShelves", "listAndCountCatalogShelfs"],
    config ? [filters, config] : [filters]
  )

const createCatalogShelves = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[]
): Promise<CatalogShelfRecord | CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord | CatalogShelfRecord[]>(
    catalogService,
    ["createCatalogShelves", "createCatalogShelfs"],
    [payloads]
  )

const updateCatalogShelves = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[]
): Promise<CatalogShelfRecord | CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord | CatalogShelfRecord[]>(
    catalogService,
    ["updateCatalogShelves", "updateCatalogShelfs"],
    [payloads]
  )

const deleteCatalogShelves = async (
  catalogService: CatalogService,
  id: string
): Promise<void> =>
  callCatalogService<void>(
    catalogService,
    ["deleteCatalogShelves", "deleteCatalogShelfs"],
    [id]
  )

const listCatalogShelfProducts = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig
): Promise<CatalogShelfProductRecord[]> =>
  callCatalogService<CatalogShelfProductRecord[]>(
    catalogService,
    ["listCatalogShelfProducts"],
    config ? [filters, config] : [filters]
  )

const createCatalogShelfProducts = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[]
): Promise<CatalogShelfProductRecord | CatalogShelfProductRecord[]> =>
  callCatalogService<CatalogShelfProductRecord | CatalogShelfProductRecord[]>(
    catalogService,
    ["createCatalogShelfProducts"],
    [payloads]
  )

const deleteCatalogShelfProducts = async (
  catalogService: CatalogService,
  ids: string[]
): Promise<void> =>
  callCatalogService<void>(
    catalogService,
    ["deleteCatalogShelfProducts"],
    [ids]
  )

export const resolveShelf = async (
  catalogService: CatalogService,
  id: string
) => {
  const shelf = await catalogService.retrieveCatalogShelf(id)
  if (!shelf) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Catalog shelf not found")
  }

  return shelf
}

export const resolveUniqueShelfHandle = async (
  catalogService: CatalogService,
  baseHandle: string,
  excludeId?: string
): Promise<string> => {
  const normalizedBase = baseHandle.trim() || "shelf"
  let candidate = normalizedBase
  let suffix = 1

  while (suffix < 50) {
    const existing = await listCatalogShelves(catalogService, {
      handle: candidate,
    })
    const collision = existing.find((shelf) => shelf.id !== excludeId)
    if (!collision) {
      return candidate
    }
    candidate = `${normalizedBase}-${suffix}`
    suffix += 1
  }

  return `${normalizedBase}-${Date.now()}`
}

export const loadShelfProducts = async (
  catalogService: CatalogService,
  shelfId: string
) => {
  const products = await listCatalogShelfProducts(
    catalogService,
    { shelf_id: shelfId },
    { order: { sort_order: "ASC" } }
  )

  return products.map(serializeCatalogShelfProduct)
}

export const serializeShelfResponse = async (
  catalogService: CatalogService,
  shelf: Awaited<ReturnType<typeof resolveShelf>>
) => ({
  shelf: serializeCatalogShelf(shelf),
  products: await loadShelfProducts(catalogService, shelf.id),
})

const assertValidDateRange = (startsAt: Date | null, endsAt: Date | null): void => {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "End date must be after start date"
    )
  }
}

const coerceDateForRange = (
  value: Date | string | null | undefined
): Date | null => {
  if (!value) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  return toOptionalDate(value)
}

const assertValidShelfMode = (
  mode: string | undefined,
  automationType: CatalogShelfAutomationType | undefined
): void => {
  if (mode === "automatic" && (!automationType || automationType === "none")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Automatic shelves require an automation type"
    )
  }
}

export const replaceShelfProducts = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  shelfId: string,
  products: ShelfProductInput[]
): Promise<void> => {
  await resolveShelf(catalogService, shelfId)
  const seen = new Set<string>()
  const existing = await listCatalogShelfProducts(catalogService, {
    shelf_id: shelfId,
  })
  const ids = existing.map((product) => product.id)
  if (ids.length) {
    await deleteCatalogShelfProducts(catalogService, ids)
  }

  const payloads = []
  for (const [index, product] of products.entries()) {
    if (seen.has(product.productId)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A shelf cannot include the same product more than once"
      )
    }
    seen.add(product.productId)
    await assertProductExists(req, product.productId)

    const startsAt = toOptionalDate(product.startsAt)
    const endsAt = toOptionalDate(product.endsAt)
    assertValidDateRange(startsAt, endsAt)

    payloads.push({
      shelf_id: shelfId,
      product_id: product.productId,
      product_profile_id: toNullableString(product.productProfileId),
      sort_order: product.sortOrder ?? index,
      is_pinned: product.isPinned ?? false,
      starts_at: startsAt,
      ends_at: endsAt,
      metadata: coerceJsonRecord(product.metadata),
    })
  }

  if (payloads.length) {
    await createCatalogShelfProducts(catalogService, payloads)
  }
}

export const upsertShelf = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  input: ShelfUpsertInput,
  id?: string
) => {
  const existing = id ? await resolveShelf(catalogService, id) : null
  if (!existing && !input.title) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Shelf title is required")
  }

  const mode = input.mode ?? existing?.mode ?? "manual"
  const automationType =
    input.automationType ?? existing?.automation_type ?? "none"
  assertValidShelfMode(mode as string, automationType as CatalogShelfAutomationType)

  const startsAt =
    input.startsAt === undefined ? undefined : toOptionalDate(input.startsAt)
  const endsAt = input.endsAt === undefined ? undefined : toOptionalDate(input.endsAt)
  assertValidDateRange(
    startsAt === undefined ? coerceDateForRange(existing?.starts_at) : startsAt,
    endsAt === undefined ? coerceDateForRange(existing?.ends_at) : endsAt
  )

  const title = input.title?.trim() ?? existing?.title
  const baseHandle = slugify(
    input.handle ?? title ?? existing?.handle ?? "shelf",
    "shelf"
  )
  const handle =
    input.handle !== undefined || !existing
      ? await resolveUniqueShelfHandle(catalogService, baseHandle, id)
      : existing.handle
  const ribbonLabel =
    input.ribbonLabel !== undefined
      ? toNullableString(input.ribbonLabel)
      : existing?.ribbon_label ?? null
  const showRibbon = input.showRibbon ?? existing?.show_ribbon ?? false

  const payload: Record<string, unknown> = {
    handle,
  }
  if (title !== undefined) {
    payload.title = title
  }
  if (input.description !== undefined) {
    payload.description = toNullableString(input.description)
  }
  if (input.mode !== undefined || !existing) {
    payload.mode = mode
  }
  if (input.automationType !== undefined || !existing) {
    payload.automation_type = automationType
  }
  if (input.showRibbon !== undefined || !existing) {
    payload.show_ribbon = showRibbon
  }
  if (input.ribbonLabel !== undefined || !existing) {
    payload.ribbon_label = showRibbon ? ribbonLabel ?? title ?? null : ribbonLabel
  }
  if (input.ribbonPriority !== undefined || !existing) {
    payload.ribbon_priority = input.ribbonPriority ?? 100
  }
  if (input.productLimit !== undefined) {
    payload.product_limit = input.productLimit ?? null
  }
  if (startsAt !== undefined) {
    payload.starts_at = startsAt
  }
  if (endsAt !== undefined) {
    payload.ends_at = endsAt
  }
  if (input.isActive !== undefined || !existing) {
    payload.is_active = input.isActive ?? true
  }
  if (input.metadata !== undefined || !existing) {
    payload.metadata = coerceJsonRecord(input.metadata)
  }

  const savedResult = existing
    ? await updateCatalogShelves(catalogService, [{ id: existing.id, ...payload }])
    : await createCatalogShelves(catalogService, [payload])
  const saved = firstResult(savedResult)
  if (!saved) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to save catalog shelf"
    )
  }

  if (input.products !== undefined) {
    await replaceShelfProducts(req, catalogService, saved.id, input.products)
  }

  const refreshed = await resolveShelf(catalogService, saved.id)
  return {
    status: existing ? 200 : 201,
    body: await serializeShelfResponse(catalogService, refreshed),
  }
}

export const deleteShelf = async (
  catalogService: CatalogService,
  id: string
): Promise<void> => {
  await resolveShelf(catalogService, id)
  const products = await listCatalogShelfProducts(catalogService, { shelf_id: id })
  const productIds = products.map((product) => product.id)
  if (productIds.length) {
    await deleteCatalogShelfProducts(catalogService, productIds)
  }
  await deleteCatalogShelves(catalogService, id)
}
