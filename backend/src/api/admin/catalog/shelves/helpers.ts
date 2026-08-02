import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaRequest } from "@medusajs/framework"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
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
  assertProductsExist,
  coerceJsonRecord,
  firstResult,
  slugify,
  toNullableString,
  toOptionalDate,
  type CatalogService,
} from "../utils"

const optionalDateSchema = z
  .string()
  .trim()
  .max(100)
  .refine(
    (value) => value.length === 0 || Number.isFinite(Date.parse(value)),
    "Invalid date.",
  )
  .optional()
  .nullable()

export const shelfProductInputSchema = z.object({
  productId: z.string().trim().min(1).max(255),
  productProfileId: z.string().trim().max(255).optional().nullable(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  isPinned: z.boolean().optional(),
  startsAt: optionalDateSchema,
  endsAt: optionalDateSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const shelfUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  handle: z.string().trim().max(255).optional().nullable(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(10_000).optional().nullable(),
  mode: z.enum(catalogShelfModeValues).optional(),
  automationType: z.enum(catalogShelfAutomationTypeValues).optional(),
  showRibbon: z.boolean().optional(),
  ribbonLabel: z.string().trim().max(500).optional().nullable(),
  ribbonPriority: z.number().int().min(0).max(1_000_000).optional(),
  productLimit: z.number().int().min(1).max(200).optional().nullable(),
  startsAt: optionalDateSchema,
  endsAt: optionalDateSchema,
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  products: z.array(shelfProductInputSchema).max(200).optional(),
})

export const shelfLifecycleSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
})

export type ShelfUpsertInput = z.infer<typeof shelfUpsertSchema>
export type ShelfProductInput = z.infer<typeof shelfProductInputSchema>
export type ShelfLifecycleInput = z.infer<typeof shelfLifecycleSchema>

type CatalogServiceMethod = (...args: unknown[]) => Promise<unknown>
type CatalogServiceMethods = Record<string, CatalogServiceMethod | undefined>
type ServiceQueryConfig = {
  skip?: number
  take?: number
  order?: Record<string, "ASC" | "DESC">
}
type CatalogTransactionContext = Context<EntityManager>

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
  config?: ServiceQueryConfig,
  sharedContext?: CatalogTransactionContext,
): Promise<CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord[]>(
    catalogService,
    ["listCatalogShelves", "listCatalogShelfs"],
    sharedContext
      ? [filters, config ?? {}, sharedContext]
      : config
        ? [filters, config]
        : [filters]
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
  payloads: Record<string, unknown>[],
  sharedContext?: CatalogTransactionContext,
): Promise<CatalogShelfRecord | CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord | CatalogShelfRecord[]>(
    catalogService,
    ["createCatalogShelves", "createCatalogShelfs"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const updateCatalogShelves = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[],
  sharedContext?: CatalogTransactionContext,
): Promise<CatalogShelfRecord | CatalogShelfRecord[]> =>
  callCatalogService<CatalogShelfRecord | CatalogShelfRecord[]>(
    catalogService,
    ["updateCatalogShelves", "updateCatalogShelfs"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const listCatalogShelfProducts = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig,
  sharedContext?: CatalogTransactionContext,
): Promise<CatalogShelfProductRecord[]> =>
  callCatalogService<CatalogShelfProductRecord[]>(
    catalogService,
    ["listCatalogShelfProducts"],
    sharedContext
      ? [filters, config ?? {}, sharedContext]
      : config
        ? [filters, config]
        : [filters]
  )

const createCatalogShelfProducts = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[],
  sharedContext?: CatalogTransactionContext,
): Promise<CatalogShelfProductRecord | CatalogShelfProductRecord[]> =>
  callCatalogService<CatalogShelfProductRecord | CatalogShelfProductRecord[]>(
    catalogService,
    ["createCatalogShelfProducts"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const deleteCatalogShelfProducts = async (
  catalogService: CatalogService,
  ids: string[],
  sharedContext?: CatalogTransactionContext,
): Promise<void> =>
  callCatalogService<void>(
    catalogService,
    ["deleteCatalogShelfProducts"],
    sharedContext ? [ids, sharedContext] : [ids]
  )

export const resolveShelf = async (
  catalogService: CatalogService,
  id: string,
  sharedContext?: CatalogTransactionContext,
) => {
  const shelf = await catalogService.retrieveCatalogShelf(
    id,
    {},
    sharedContext,
  )
  if (!shelf) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Catalog shelf not found")
  }

  return shelf
}

export const resolveUniqueShelfHandle = async (
  catalogService: CatalogService,
  baseHandle: string,
  excludeId?: string,
  sharedContext?: CatalogTransactionContext,
): Promise<string> => {
  const normalizedBase = baseHandle.trim() || "shelf"
  let candidate = normalizedBase
  let suffix = 1

  while (suffix < 50) {
    const existing = await listCatalogShelves(catalogService, {
      handle: candidate,
    }, undefined, sharedContext)
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
  shelfId: string,
  sharedContext?: CatalogTransactionContext,
) => {
  const products = await listCatalogShelfProducts(
    catalogService,
    { shelf_id: shelfId },
    { order: { sort_order: "ASC" } },
    sharedContext,
  )

  return products.map(serializeCatalogShelfProduct)
}

export const loadShelfProductsByShelfId = async (
  catalogService: CatalogService,
  shelfIds: readonly string[],
): Promise<Map<string, ReturnType<typeof serializeCatalogShelfProduct>[]>> => {
  const uniqueShelfIds = [...new Set(shelfIds)]
  const grouped = new Map<
    string,
    ReturnType<typeof serializeCatalogShelfProduct>[]
  >(uniqueShelfIds.map((shelfId) => [shelfId, []]))
  if (!uniqueShelfIds.length) {
    return grouped
  }

  const products = await listCatalogShelfProducts(
    catalogService,
    { shelf_id: uniqueShelfIds },
    {
      order: { sort_order: "ASC" },
      take: uniqueShelfIds.length * 200,
    },
  )
  for (const product of products) {
    const serialized = serializeCatalogShelfProduct(product)
    grouped.get(product.shelf_id)?.push(serialized)
  }
  return grouped
}

export const serializeShelfResponse = async (
  catalogService: CatalogService,
  shelf: Awaited<ReturnType<typeof resolveShelf>>,
  sharedContext?: CatalogTransactionContext,
) => ({
  shelf: serializeCatalogShelf(shelf),
  products: await loadShelfProducts(catalogService, shelf.id, sharedContext),
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

const hasTransactionConflict = (error: unknown): boolean => {
  let current = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") {
      return false
    }
    const candidate = current as {
      cause?: unknown
      code?: unknown
      message?: unknown
    }
    if (
      candidate.code === "40001" ||
      candidate.code === "40P01" ||
      (typeof candidate.message === "string" &&
        /could not serialize|deadlock detected/i.test(candidate.message))
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

const runShelfTransaction = async <T>(
  catalogService: CatalogService,
  task: (sharedContext: CatalogTransactionContext) => Promise<T>,
): Promise<T> => {
  try {
    return await catalogService.runCatalogTransaction(task)
  } catch (error) {
    if (hasTransactionConflict(error)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed while it was being saved. Refresh and retry.",
      )
    }
    throw error
  }
}

type PreparedShelfProduct = {
  product_id: string
  product_profile_id: string | null
  sort_order: number
  is_pinned: boolean
  starts_at: Date | null
  ends_at: Date | null
  metadata: Record<string, unknown>
}

export const prepareShelfProducts = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  products: ShelfProductInput[],
): Promise<PreparedShelfProduct[]> => {
  const seen = new Set<string>()
  const payloads: PreparedShelfProduct[] = []
  for (const [index, product] of products.entries()) {
    if (seen.has(product.productId)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A shelf cannot include the same product more than once"
      )
    }
    seen.add(product.productId)

    const startsAt = toOptionalDate(product.startsAt)
    const endsAt = toOptionalDate(product.endsAt)
    assertValidDateRange(startsAt, endsAt)

    payloads.push({
      product_id: product.productId,
      product_profile_id: toNullableString(product.productProfileId),
      sort_order: product.sortOrder ?? index,
      is_pinned: product.isPinned ?? false,
      starts_at: startsAt,
      ends_at: endsAt,
      metadata: coerceJsonRecord(product.metadata),
    })
  }

  await assertProductsExist(
    req,
    payloads.map((product) => product.product_id),
  )
  const profileIds = [
    ...new Set(
      payloads.flatMap((product) =>
        product.product_profile_id ? [product.product_profile_id] : [],
      ),
    ),
  ]
  if (profileIds.length) {
    const profiles = await catalogService.listCatalogProductProfiles(
      { id: profileIds },
      { take: profileIds.length },
    )
    const profilesById = new Map(
      profiles.map((profile) => [profile.id, profile.product_id]),
    )
    for (const product of payloads) {
      if (
        product.product_profile_id &&
        profilesById.get(product.product_profile_id) !== product.product_id
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "A shelf product profile must belong to its selected product.",
        )
      }
    }
  }
  return payloads
}

export const replaceShelfProducts = async (
  catalogService: CatalogService,
  shelfId: string,
  products: PreparedShelfProduct[],
  sharedContext?: CatalogTransactionContext,
): Promise<void> => {
  await resolveShelf(catalogService, shelfId, sharedContext)
  const existing = await listCatalogShelfProducts(
    catalogService,
    { shelf_id: shelfId },
    undefined,
    sharedContext,
  )
  const ids = existing.map((product) => product.id)
  if (ids.length) {
    await deleteCatalogShelfProducts(catalogService, ids, sharedContext)
  }

  if (products.length) {
    await createCatalogShelfProducts(
      catalogService,
      products.map((product) => ({ ...product, shelf_id: shelfId })),
      sharedContext,
    )
  }
}

export const upsertShelf = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  input: ShelfUpsertInput,
  id?: string,
) => {
  const preparedProducts =
    input.products === undefined
      ? undefined
      : await prepareShelfProducts(req, catalogService, input.products)
  const actorId = (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null
  const { expectedVersion, idempotencyKey, products: _products, ...patch } =
    input
  const command = id ? "catalog.shelf.upsert" : "catalog.shelf.create"
  const aggregateId = id ?? `new:${idempotencyKey}`
  const requestSha256 = hashCatalogCommand({
    aggregateId,
    command,
    expectedVersion,
    patch: { ...patch, products: input.products },
  })

  return runShelfTransaction(catalogService, async (sharedContext) => {
    const existingOperation = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: idempotencyKey },
        { take: 1 },
        sharedContext,
      )
    )[0]
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === command &&
        existingOperation.aggregate_id === aggregateId &&
        existingOperation.actor_id === actorId &&
        existingOperation.expected_version === expectedVersion &&
        existingOperation.request_sha256 === requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this shelf command.",
        )
      }
      const result = coerceJsonRecord(existingOperation.result)
      const shelfId = typeof result.shelfId === "string" ? result.shelfId : null
      if (!shelfId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed shelf command has no shelf result.",
        )
      }
      const replayedShelf = await resolveShelf(
        catalogService,
        shelfId,
        sharedContext,
      )
      return {
        status: result.created === true ? 201 : 200,
        body: await serializeShelfResponse(
          catalogService,
          replayedShelf,
          sharedContext,
        ),
      }
    }

    const existing = id
      ? await resolveShelf(catalogService, id, sharedContext)
      : null
    if (!existing && !input.title) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shelf title is required",
      )
    }
    if (existing?.archived_at) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Restore the shelf before editing it.",
      )
    }
    const currentVersion = existing?.version ?? 0
    if (currentVersion !== expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed after it was loaded. Refresh before saving.",
      )
    }

    const mode = input.mode ?? existing?.mode ?? "manual"
    const automationType =
      input.automationType ?? existing?.automation_type ?? "none"
    assertValidShelfMode(
      mode as string,
      automationType as CatalogShelfAutomationType,
    )
    const startsAt =
      input.startsAt === undefined ? undefined : toOptionalDate(input.startsAt)
    const endsAt =
      input.endsAt === undefined ? undefined : toOptionalDate(input.endsAt)
    assertValidDateRange(
      startsAt === undefined
        ? coerceDateForRange(existing?.starts_at)
        : startsAt,
      endsAt === undefined ? coerceDateForRange(existing?.ends_at) : endsAt,
    )

    const [operation] = await catalogService.createCatalogAuthoringOperations(
      [
        {
          actor_id: actorId,
          aggregate_id: aggregateId,
          command,
          expected_version: expectedVersion,
          idempotency_key: idempotencyKey,
          metadata: {},
          request_sha256: requestSha256,
          result: {},
          status: "pending",
        },
      ],
      sharedContext,
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The shelf command audit record was not created.",
      )
    }

    const title = input.title?.trim() ?? existing?.title
    const baseHandle = slugify(
      input.handle ?? title ?? existing?.handle ?? "shelf",
      "shelf",
    )
    const handle =
      input.handle !== undefined || !existing
        ? await resolveUniqueShelfHandle(
            catalogService,
            baseHandle,
            id,
            sharedContext,
          )
        : existing.handle
    const ribbonLabel =
      input.ribbonLabel !== undefined
        ? toNullableString(input.ribbonLabel)
        : existing?.ribbon_label ?? null
    const showRibbon = input.showRibbon ?? existing?.show_ribbon ?? false
    const version = currentVersion + 1
    const payload: Record<string, unknown> = { handle, version }
    if (!existing) {
      payload.archived_at = null
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
      payload.ribbon_label = showRibbon
        ? ribbonLabel ?? title ?? null
        : ribbonLabel
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
      ? await updateCatalogShelves(
          catalogService,
          [{ id: existing.id, ...payload }],
          sharedContext,
        )
      : await createCatalogShelves(
          catalogService,
          [payload],
          sharedContext,
        )
    const saved = firstResult(savedResult)
    if (!saved) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to save catalog shelf",
      )
    }
    if (preparedProducts !== undefined) {
      await replaceShelfProducts(
        catalogService,
        saved.id,
        preparedProducts,
        sharedContext,
      )
    }

    const result = {
      created: !existing,
      shelfId: saved.id,
      version,
    }
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: null,
          error_detail: null,
          id: operation.id,
          result,
          status: "succeeded",
        },
      ],
      sharedContext,
    )
    const refreshed = await resolveShelf(
      catalogService,
      saved.id,
      sharedContext,
    )
    return {
      status: existing ? 200 : 201,
      body: await serializeShelfResponse(
        catalogService,
        refreshed,
        sharedContext,
      ),
    }
  })
}

export const setShelfArchived = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  id: string,
  input: ShelfLifecycleInput,
  archived: boolean,
) => {
  const actorId = (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null
  const command = archived ? "catalog.shelf.archive" : "catalog.shelf.restore"
  const requestSha256 = hashCatalogCommand({
    aggregateId: id,
    command,
    expectedVersion: input.expectedVersion,
  })

  return runShelfTransaction(catalogService, async (sharedContext) => {
    const existingOperation = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext,
      )
    )[0]
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === command &&
        existingOperation.aggregate_id === id &&
        existingOperation.actor_id === actorId &&
        existingOperation.expected_version === input.expectedVersion &&
        existingOperation.request_sha256 === requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this shelf command.",
        )
      }
      const replayedShelf = await resolveShelf(
        catalogService,
        id,
        sharedContext,
      )
      return serializeShelfResponse(
        catalogService,
        replayedShelf,
        sharedContext,
      )
    }

    const shelf = await resolveShelf(catalogService, id, sharedContext)
    if (shelf.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed after it was loaded. Refresh before continuing.",
      )
    }
    if (Boolean(shelf.archived_at) === archived) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        archived ? "The shelf is already archived." : "The shelf is not archived.",
      )
    }
    const [operation] = await catalogService.createCatalogAuthoringOperations(
      [
        {
          actor_id: actorId,
          aggregate_id: id,
          command,
          expected_version: input.expectedVersion,
          idempotency_key: input.idempotencyKey,
          metadata: {},
          request_sha256: requestSha256,
          result: {},
          status: "pending",
        },
      ],
      sharedContext,
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The shelf command audit record was not created.",
      )
    }

    const version = shelf.version + 1
    await updateCatalogShelves(
      catalogService,
      [
        {
          archived_at: archived ? new Date() : null,
          id,
          is_active: archived ? false : shelf.is_active,
          version,
        },
      ],
      sharedContext,
    )
    const result = { archived, shelfId: id, version }
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: null,
          error_detail: null,
          id: operation.id,
          result,
          status: "succeeded",
        },
      ],
      sharedContext,
    )
    const refreshed = await resolveShelf(catalogService, id, sharedContext)
    return serializeShelfResponse(catalogService, refreshed, sharedContext)
  })
}
