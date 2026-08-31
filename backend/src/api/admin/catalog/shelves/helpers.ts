import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaRequest } from "@medusajs/framework"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import {
  callCatalogServiceMethod,
  CatalogServiceMethodError,
} from "@/lib/catalog/catalog-service-method"
import {
  readAdminCatalogProductProfiles,
  readAdminCatalogShelf,
  readAdminCatalogShelfList,
  readAdminCatalogShelfMutation,
  readAdminCatalogShelfProducts,
  readExactAdminCatalogShelfProducts,
  readShelfLifecycleOperationResult,
  readShelfOperationList,
  readShelfOperationMutation,
  readShelfUpsertOperationResult,
  type ShelfOperationExpectation,
} from "@/lib/catalog/shelf-persistence-contracts"
import {
  catalogShelfAutomationTypeValues,
  catalogShelfModeValues,
  type CatalogShelfAutomationType,
  serializeCatalogShelf,
  serializeCatalogShelfProduct,
} from "@/modules/catalog/serializers"
import {
  assertProductsExist,
  coerceJsonRecord,
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
    "Invalid date."
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

type ServiceQueryConfig = {
  skip?: number
  take?: number
  order?: Record<string, "ASC" | "DESC">
}
type CatalogTransactionContext = Context<EntityManager>

const callCatalogService = async (
  catalogService: CatalogService,
  candidates: readonly string[],
  args: unknown[]
): Promise<unknown> => {
  try {
    return await callCatalogServiceMethod(catalogService, candidates, args)
  } catch (error) {
    if (error instanceof CatalogServiceMethodError) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, error.message)
    }
    throw error
  }
}

export const listCatalogShelves = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig,
  sharedContext?: CatalogTransactionContext
): Promise<unknown> =>
  callCatalogService(
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
): Promise<unknown> =>
  callCatalogService(
    catalogService,
    ["listAndCountCatalogShelves", "listAndCountCatalogShelfs"],
    config ? [filters, config] : [filters]
  )

const createCatalogShelves = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[],
  sharedContext?: CatalogTransactionContext
): Promise<unknown> =>
  callCatalogService(
    catalogService,
    ["createCatalogShelves", "createCatalogShelfs"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const updateCatalogShelves = async (
  catalogService: CatalogService,
  payloads: Record<string, unknown>[],
  sharedContext?: CatalogTransactionContext
): Promise<unknown> =>
  callCatalogService(
    catalogService,
    ["updateCatalogShelves", "updateCatalogShelfs"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const listCatalogShelfProducts = async (
  catalogService: CatalogService,
  filters: Record<string, unknown>,
  config?: ServiceQueryConfig,
  sharedContext?: CatalogTransactionContext
): Promise<unknown> =>
  callCatalogService(
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
  sharedContext?: CatalogTransactionContext
): Promise<unknown> =>
  callCatalogService(
    catalogService,
    ["createCatalogShelfProducts"],
    sharedContext ? [payloads, sharedContext] : [payloads]
  )

const deleteCatalogShelfProducts = async (
  catalogService: CatalogService,
  ids: string[],
  sharedContext?: CatalogTransactionContext
): Promise<void> => {
  await callCatalogService(
    catalogService,
    ["deleteCatalogShelfProducts"],
    sharedContext ? [ids, sharedContext] : [ids]
  )
}

export const resolveShelf = async (
  catalogService: CatalogService,
  id: string,
  sharedContext?: CatalogTransactionContext
) => {
  const shelf = readAdminCatalogShelf(
    await catalogService.retrieveCatalogShelf(id, {}, sharedContext),
    id
  )
  if (!shelf) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog shelf not found"
    )
  }

  return shelf
}

export const resolveUniqueShelfHandle = async (
  catalogService: CatalogService,
  baseHandle: string,
  excludeId?: string,
  sharedContext?: CatalogTransactionContext
): Promise<string> => {
  const normalizedBase = baseHandle.trim() || "shelf"
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate =
      suffix === 0 ? normalizedBase : `${normalizedBase}-${suffix}`
    const existing = readAdminCatalogShelfList(
      await listCatalogShelves(
        catalogService,
        {
          handle: candidate,
        },
        undefined,
        sharedContext
      ),
      { expectedHandle: candidate, maximumRows: 100 }
    )
    const collision = existing.find((shelf) => shelf.id !== excludeId)
    if (!collision) {
      return candidate
    }
  }
  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    "Unable to allocate a unique shelf handle. Choose a more specific handle."
  )
}

export const loadShelfProducts = async (
  catalogService: CatalogService,
  shelfId: string,
  sharedContext?: CatalogTransactionContext
) => {
  const products = readAdminCatalogShelfProducts(
    await listCatalogShelfProducts(
      catalogService,
      { shelf_id: shelfId },
      { order: { sort_order: "ASC", id: "ASC" } },
      sharedContext
    ),
    [shelfId],
    200
  )

  return products
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    )
    .map(serializeCatalogShelfProduct)
}

export const loadShelfProductsByShelfId = async (
  catalogService: CatalogService,
  shelfIds: readonly string[]
): Promise<Map<string, ReturnType<typeof serializeCatalogShelfProduct>[]>> => {
  const uniqueShelfIds = [...new Set(shelfIds)]
  const grouped = new Map<
    string,
    ReturnType<typeof serializeCatalogShelfProduct>[]
  >(uniqueShelfIds.map((shelfId) => [shelfId, []]))
  if (!uniqueShelfIds.length) {
    return grouped
  }

  const products = readAdminCatalogShelfProducts(
    await listCatalogShelfProducts(
      catalogService,
      { shelf_id: uniqueShelfIds },
      {
        order: { sort_order: "ASC", id: "ASC" },
        take: uniqueShelfIds.length * 200,
      }
    ),
    uniqueShelfIds,
    uniqueShelfIds.length * 200
  )
  for (const product of products.sort(
    (left, right) =>
      left.sort_order - right.sort_order || left.id.localeCompare(right.id)
  )) {
    const serialized = serializeCatalogShelfProduct(product)
    grouped.get(product.shelf_id)?.push(serialized)
  }
  return grouped
}

export const serializeShelfResponse = async (
  catalogService: CatalogService,
  shelf: Awaited<ReturnType<typeof resolveShelf>>,
  sharedContext?: CatalogTransactionContext,
  products?: ReturnType<typeof serializeCatalogShelfProduct>[]
) => ({
  shelf: serializeCatalogShelf(shelf),
  products:
    products ??
    (await loadShelfProducts(catalogService, shelf.id, sharedContext)),
})

const assertValidDateRange = (
  startsAt: Date | null,
  endsAt: Date | null
): void => {
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
  task: (sharedContext: CatalogTransactionContext) => Promise<T>
): Promise<T> => {
  try {
    return await catalogService.runCatalogTransaction(task)
  } catch (error) {
    if (hasTransactionConflict(error)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed while it was being saved. Refresh and retry."
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
  sharedContext?: CatalogTransactionContext
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
    payloads.map((product) => product.product_id)
  )
  const profileIds = [
    ...new Set(
      payloads.flatMap((product) =>
        product.product_profile_id ? [product.product_profile_id] : []
      )
    ),
  ]
  if (profileIds.length) {
    const profiles = readAdminCatalogProductProfiles(
      await catalogService.listCatalogProductProfiles(
        { id: profileIds },
        { take: profileIds.length },
        sharedContext
      ),
      profileIds
    )
    const profilesById = new Map(
      profiles.map((profile) => [profile.id, profile.product_id])
    )
    for (const product of payloads) {
      if (
        product.product_profile_id &&
        profilesById.get(product.product_profile_id) !== product.product_id
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "A shelf product profile must belong to its selected product."
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
  sharedContext?: CatalogTransactionContext
): Promise<ReturnType<typeof serializeCatalogShelfProduct>[]> => {
  await resolveShelf(catalogService, shelfId, sharedContext)
  const existing = readAdminCatalogShelfProducts(
    await listCatalogShelfProducts(
      catalogService,
      { shelf_id: shelfId },
      undefined,
      sharedContext
    ),
    [shelfId],
    200
  )
  const ids = existing.map((product) => product.id)
  if (ids.length) {
    await deleteCatalogShelfProducts(catalogService, ids, sharedContext)
  }

  if (products.length) {
    readExactAdminCatalogShelfProducts(
      await createCatalogShelfProducts(
        catalogService,
        products.map((product) => ({ ...product, shelf_id: shelfId })),
        sharedContext
      ),
      shelfId,
      products
    )
  }

  return readExactAdminCatalogShelfProducts(
    await listCatalogShelfProducts(
      catalogService,
      { shelf_id: shelfId },
      { order: { sort_order: "ASC", id: "ASC" } },
      sharedContext
    ),
    shelfId,
    products
  )
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    )
    .map(serializeCatalogShelfProduct)
}

export const upsertShelf = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  input: ShelfUpsertInput,
  id?: string
) => {
  const actorId =
    (
      req as MedusaRequest & {
        auth_context?: { actor_id?: string | null }
      }
    ).auth_context?.actor_id ?? null
  const {
    expectedVersion,
    idempotencyKey,
    products: _products,
    ...patch
  } = input
  const command = id ? "catalog.shelf.upsert" : "catalog.shelf.create"
  const aggregateId = id ?? `new:${idempotencyKey}`
  const requestSha256 = hashCatalogCommand({
    aggregateId,
    command,
    expectedVersion,
    patch: { ...patch, products: input.products },
  })

  return runShelfTransaction(catalogService, async (sharedContext) => {
    const existingOperation = readShelfOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: idempotencyKey },
        { take: 1 },
        sharedContext
      )
    )
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === command &&
        existingOperation.aggregateId === aggregateId &&
        existingOperation.actorId === actorId &&
        existingOperation.expectedVersion === expectedVersion &&
        existingOperation.idempotencyKey === idempotencyKey &&
        existingOperation.requestSha256 === requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this shelf command."
        )
      }
      const result = readShelfUpsertOperationResult(existingOperation.result)
      if (
        result.created !== !id ||
        (id !== undefined && result.shelfId !== id) ||
        result.version !== expectedVersion + 1
      ) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed shelf command result did not match the requested write."
        )
      }
      const replayedShelf = await resolveShelf(
        catalogService,
        result.shelfId,
        sharedContext
      )
      if (replayedShelf.version !== result.version) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed shelf command no longer has its exact shelf response."
        )
      }
      return {
        status: result.created ? 201 : 200,
        body: await serializeShelfResponse(
          catalogService,
          replayedShelf,
          sharedContext
        ),
      }
    }

    const preparedProducts =
      input.products === undefined
        ? undefined
        : await prepareShelfProducts(
            req,
            catalogService,
            input.products,
            sharedContext
          )

    const existing = id
      ? await resolveShelf(catalogService, id, sharedContext)
      : null
    if (!existing && !input.title) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shelf title is required"
      )
    }
    if (existing?.archived_at) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Restore the shelf before editing it."
      )
    }
    const currentVersion = existing?.version ?? 0
    if (currentVersion !== expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed after it was loaded. Refresh before saving."
      )
    }

    const mode = input.mode ?? existing?.mode ?? "manual"
    const automationType =
      input.automationType ?? existing?.automation_type ?? "none"
    assertValidShelfMode(
      mode as string,
      automationType as CatalogShelfAutomationType
    )
    const startsAt =
      input.startsAt === undefined ? undefined : toOptionalDate(input.startsAt)
    const endsAt =
      input.endsAt === undefined ? undefined : toOptionalDate(input.endsAt)
    assertValidDateRange(
      startsAt === undefined
        ? coerceDateForRange(existing?.starts_at)
        : startsAt,
      endsAt === undefined ? coerceDateForRange(existing?.ends_at) : endsAt
    )

    const operationExpectation: ShelfOperationExpectation = {
      actorId,
      aggregateId,
      command,
      expectedVersion,
      idempotencyKey,
      requestSha256,
      status: "pending",
    }
    const operation = readShelfOperationMutation(
      await catalogService.createCatalogAuthoringOperations(
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
        sharedContext
      ),
      operationExpectation
    )

    const title = input.title?.trim() ?? existing?.title
    const baseHandle = slugify(
      input.handle ?? title ?? existing?.handle ?? "shelf",
      "shelf"
    )
    const handle =
      input.handle !== undefined || !existing
        ? await resolveUniqueShelfHandle(
            catalogService,
            baseHandle,
            id,
            sharedContext
          )
        : existing.handle
    const ribbonLabel =
      input.ribbonLabel !== undefined
        ? toNullableString(input.ribbonLabel)
        : (existing?.ribbon_label ?? null)
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
        ? (ribbonLabel ?? title ?? null)
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
          sharedContext
        )
      : await createCatalogShelves(catalogService, [payload], sharedContext)
    const saved = readAdminCatalogShelfMutation(
      savedResult,
      existing
        ? { fields: payload, id: existing.id, version }
        : { fields: payload, version }
    )
    let persistedProducts:
      | ReturnType<typeof serializeCatalogShelfProduct>[]
      | undefined
    if (preparedProducts !== undefined) {
      persistedProducts = await replaceShelfProducts(
        catalogService,
        saved.id,
        preparedProducts,
        sharedContext
      )
    }

    const result = {
      created: !existing,
      shelfId: saved.id,
      version,
    }
    const completedOperation = readShelfOperationMutation(
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
        sharedContext
      ),
      { ...operationExpectation, id: operation.id, status: "succeeded" }
    )
    const completedResult = readShelfUpsertOperationResult(
      completedOperation.result
    )
    if (
      completedResult.created !== result.created ||
      completedResult.shelfId !== result.shelfId ||
      completedResult.version !== result.version
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The shelf command audit acknowledgement did not match the saved shelf."
      )
    }
    const refreshed = await resolveShelf(
      catalogService,
      saved.id,
      sharedContext
    )
    if (refreshed.version !== version) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The saved shelf could not be read back at its acknowledged version."
      )
    }
    return {
      status: existing ? 200 : 201,
      body: await serializeShelfResponse(
        catalogService,
        refreshed,
        sharedContext,
        persistedProducts
      ),
    }
  })
}

export const setShelfArchived = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  id: string,
  input: ShelfLifecycleInput,
  archived: boolean
) => {
  const actorId =
    (
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
    const existingOperation = readShelfOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext
      )
    )
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === command &&
        existingOperation.aggregateId === id &&
        existingOperation.actorId === actorId &&
        existingOperation.expectedVersion === input.expectedVersion &&
        existingOperation.idempotencyKey === input.idempotencyKey &&
        existingOperation.requestSha256 === requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this shelf command."
        )
      }
      const result = readShelfLifecycleOperationResult(existingOperation.result)
      if (
        result.archived !== archived ||
        result.shelfId !== id ||
        result.version !== input.expectedVersion + 1
      ) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed shelf lifecycle result did not match the requested change."
        )
      }
      const replayedShelf = await resolveShelf(
        catalogService,
        id,
        sharedContext
      )
      if (
        replayedShelf.version !== result.version ||
        Boolean(replayedShelf.archived_at) !== result.archived
      ) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed shelf lifecycle command no longer has its exact response."
        )
      }
      return serializeShelfResponse(
        catalogService,
        replayedShelf,
        sharedContext
      )
    }

    const shelf = await resolveShelf(catalogService, id, sharedContext)
    if (shelf.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The shelf changed after it was loaded. Refresh before continuing."
      )
    }
    if (Boolean(shelf.archived_at) === archived) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        archived
          ? "The shelf is already archived."
          : "The shelf is not archived."
      )
    }
    const operationExpectation: ShelfOperationExpectation = {
      actorId,
      aggregateId: id,
      command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestSha256,
      status: "pending",
    }
    const operation = readShelfOperationMutation(
      await catalogService.createCatalogAuthoringOperations(
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
        sharedContext
      ),
      operationExpectation
    )

    const version = shelf.version + 1
    const archivedAt = archived ? new Date() : null
    readAdminCatalogShelfMutation(
      await updateCatalogShelves(
        catalogService,
        [
          {
            archived_at: archivedAt,
            id,
            is_active: archived ? false : shelf.is_active,
            version,
          },
        ],
        sharedContext
      ),
      {
        fields: {
          archived_at: archivedAt,
          is_active: archived ? false : shelf.is_active,
        },
        id,
        version,
      }
    )
    const result = { archived, shelfId: id, version }
    const completedOperation = readShelfOperationMutation(
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
        sharedContext
      ),
      { ...operationExpectation, id: operation.id, status: "succeeded" }
    )
    const completedResult = readShelfLifecycleOperationResult(
      completedOperation.result
    )
    if (
      completedResult.archived !== result.archived ||
      completedResult.shelfId !== result.shelfId ||
      completedResult.version !== result.version
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The shelf lifecycle audit acknowledgement did not match the saved shelf."
      )
    }
    const refreshed = await resolveShelf(catalogService, id, sharedContext)
    if (
      refreshed.version !== version ||
      Boolean(refreshed.archived_at) !== archived
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The saved shelf lifecycle state could not be read back exactly."
      )
    }
    return serializeShelfResponse(catalogService, refreshed, sharedContext)
  })
}
