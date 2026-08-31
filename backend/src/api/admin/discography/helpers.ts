import type { MedusaRequest } from "@medusajs/framework"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

import {
  readAdminDiscographyEntry,
  readAdminDiscographyMutation,
  readContentOperationList,
  readContentOperationMutation,
  readDiscographyOperationResult,
  type ContentOperationProjection,
} from "@/lib/content/persistence-contracts"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import type DiscographyModuleService from "@/modules/discography/service"
import {
  discographyAvailabilityValues,
  type DiscographyEntryRecord,
  serializeDiscographyEntry,
} from "@/modules/discography/serializers"

export type DiscographyService = InstanceType<typeof DiscographyModuleService>
type DiscographyTransactionContext = Context<EntityManager>

const optionalDateSchema = z
  .string()
  .trim()
  .max(100)
  .refine(
    (value) => value.length === 0 || Number.isFinite(Date.parse(value)),
    "Invalid release date."
  )
  .optional()
  .nullable()

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable()

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const normalizedListSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(100)
  .optional()

const manualFieldsSchema = z.object({
  artist: z.string().trim().min(1).max(500).optional(),
  availability: z.enum(discographyAvailabilityValues).optional(),
  catalogNumber: optionalText(200),
  collectionTitle: optionalText(500),
  coverAltText: optionalText(500),
  coverUrl: z
    .string()
    .trim()
    .url()
    .max(2_000)
    .refine(isHttpUrl, "Cover URL must use http or https.")
    .optional()
    .nullable(),
  formats: normalizedListSchema,
  genres: normalizedListSchema,
  releaseDate: optionalDateSchema,
  releaseTitle: z.string().trim().min(1).max(500).optional(),
  releaseYear: z.number().int().min(1900).max(2200).optional().nullable(),
  tags: normalizedListSchema,
})

export const manualDiscographyCreateSchema = manualFieldsSchema
  .extend({
    artist: z.string().trim().min(1).max(500),
    expectedVersion: z.literal(0),
    idempotencyKey: z.string().uuid(),
    releaseTitle: z.string().trim().min(1).max(500),
  })
  .superRefine((value, context) => {
    if (value.coverUrl && !value.coverAltText) {
      context.addIssue({
        code: "custom",
        message: "Cover alt text is required when cover artwork is present.",
        path: ["coverAltText"],
      })
    }
  })

export const manualDiscographyUpdateSchema = manualFieldsSchema.extend({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
})

export const discographyLifecycleSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
})

export type ManualDiscographyCreateInput = z.infer<
  typeof manualDiscographyCreateSchema
>
export type ManualDiscographyUpdateInput = z.infer<
  typeof manualDiscographyUpdateSchema
>
export type DiscographyLifecycleInput = z.infer<
  typeof discographyLifecycleSchema
>

type DiscographyCommandInput = {
  aggregateId: string
  command: string
  expectedVersion: number
  idempotencyKey: string
  payload?: unknown
}

const requestActorId = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null

const normalizeList = (values: string[] | undefined): string[] | undefined => {
  if (!values) {
    return undefined
  }
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const normalized = value.trim()
    const key = normalized.toLocaleLowerCase("en-US")
    if (!normalized || seen.has(key)) {
      return []
    }
    seen.add(key)
    return [normalized]
  })
}

const toNullableString = (value: string | null | undefined): string | null => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

const toOptionalDate = (value: string | null | undefined): Date | null => {
  if (!value?.trim()) {
    return null
  }
  return new Date(value)
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

const runDiscographyTransaction = async <T>(
  service: DiscographyService,
  task: (sharedContext: DiscographyTransactionContext) => Promise<T>
): Promise<T> => {
  try {
    return await service.runDiscographyTransaction(task)
  } catch (error) {
    if (hasTransactionConflict(error)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The discography entry changed while it was being saved. Refresh and retry."
      )
    }
    throw error
  }
}

const resolveEntry = async (
  service: DiscographyService,
  id: string,
  sharedContext?: DiscographyTransactionContext
): Promise<DiscographyEntryRecord> => {
  const entry = readAdminDiscographyEntry(
    await service.retrieveDiscographyEntry(id, {}, sharedContext),
    id
  )
  if (!entry) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Discography entry not found"
    )
  }
  return entry
}

const replayCommand = async (
  service: DiscographyService,
  actorId: string | null,
  input: DiscographyCommandInput,
  sharedContext: DiscographyTransactionContext
): Promise<DiscographyEntryRecord | null> => {
  const requestSha256 = hashCatalogCommand({
    aggregateId: input.aggregateId,
    command: input.command,
    expectedVersion: input.expectedVersion,
    payload: input.payload ?? {},
  })
  const operation = readContentOperationList(
    await service.listDiscographyOperations(
      { idempotency_key: input.idempotencyKey },
      { take: 1 },
      sharedContext
    ),
    "discography"
  )
  if (!operation) {
    return null
  }
  const sameCommand =
    operation.aggregateId === input.aggregateId &&
    operation.command === input.command &&
    operation.actorId === actorId &&
    operation.expectedVersion === input.expectedVersion &&
    operation.idempotencyKey === input.idempotencyKey &&
    operation.requestSha256 === requestSha256 &&
    operation.status === "succeeded"
  if (!sameCommand) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The discography idempotency key cannot be replayed for this command."
    )
  }
  const result = readDiscographyOperationResult(operation.result)
  const entry = await resolveEntry(service, result.entryId, sharedContext)
  if (entry.version !== result.version) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The completed discography command no longer has its exact entry response."
    )
  }
  return entry
}

const createOperation = async (
  service: DiscographyService,
  actorId: string | null,
  input: DiscographyCommandInput,
  sharedContext: DiscographyTransactionContext
): Promise<ContentOperationProjection> => {
  const requestSha256 = hashCatalogCommand({
    aggregateId: input.aggregateId,
    command: input.command,
    expectedVersion: input.expectedVersion,
    payload: input.payload ?? {},
  })
  return readContentOperationMutation(
    await service.createDiscographyOperations(
      [
        {
          actor_id: actorId,
          aggregate_id: input.aggregateId,
          command: input.command,
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
    {
      actorId,
      aggregateId: input.aggregateId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      kind: "discography",
      requestSha256,
      status: "pending",
    }
  )
}

const completeOperation = async (
  service: DiscographyService,
  operation: ContentOperationProjection,
  entry: DiscographyEntryRecord,
  sharedContext: DiscographyTransactionContext
): Promise<void> => {
  const completed = readContentOperationMutation(
    await service.updateDiscographyOperations(
      [
        {
          completed_at: new Date(),
          id: operation.id,
          result: { entryId: entry.id, version: entry.version },
          status: "succeeded",
        },
      ],
      sharedContext
    ),
    {
      actorId: operation.actorId,
      aggregateId: operation.aggregateId,
      command: operation.command,
      expectedVersion: operation.expectedVersion,
      idempotencyKey: operation.idempotencyKey,
      kind: "discography",
      requestSha256: operation.requestSha256,
      status: "succeeded",
    }
  )
  const result = readDiscographyOperationResult(completed.result)
  if (result.entryId !== entry.id || result.version !== entry.version) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The discography command audit acknowledgement did not match the entry."
    )
  }
}

const validateDateAndYear = (
  releaseDate: Date | string | null | undefined,
  releaseYear: number | null | undefined
): void => {
  if (!releaseDate || releaseYear === null || releaseYear === undefined) {
    return
  }
  const parsed =
    releaseDate instanceof Date ? releaseDate : new Date(releaseDate)
  if (parsed.getUTCFullYear() !== releaseYear) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Release year must match the release date."
    )
  }
}

const buildManualPatch = (
  input: ManualDiscographyCreateInput | ManualDiscographyUpdateInput,
  existing?: DiscographyEntryRecord
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (input.releaseTitle !== undefined) {
    patch.title = input.releaseTitle.trim()
    patch.album = input.releaseTitle.trim()
  }
  if (input.artist !== undefined) patch.artist = input.artist.trim()
  if (input.collectionTitle !== undefined) {
    patch.collection_title = toNullableString(input.collectionTitle)
  }
  if (input.catalogNumber !== undefined) {
    patch.catalog_number = toNullableString(input.catalogNumber)
  }
  if (input.releaseDate !== undefined) {
    patch.release_date = toOptionalDate(input.releaseDate)
  }
  if (input.releaseYear !== undefined) {
    patch.release_year = input.releaseYear
  } else if (input.releaseDate) {
    patch.release_year = new Date(input.releaseDate).getUTCFullYear()
  }
  if (input.formats !== undefined) patch.formats = normalizeList(input.formats)
  if (input.genres !== undefined) patch.genres = normalizeList(input.genres)
  if (input.tags !== undefined) patch.tags = normalizeList(input.tags)
  if (input.availability !== undefined) {
    patch.availability = input.availability
  }
  if (input.coverUrl !== undefined) {
    patch.cover_url = input.coverUrl
  }
  if (input.coverAltText !== undefined) {
    patch.cover_alt_text = toNullableString(input.coverAltText)
  }

  const effectiveCoverUrl =
    patch.cover_url !== undefined
      ? (patch.cover_url as string | null)
      : (existing?.cover_url ?? null)
  const effectiveCoverAltText =
    patch.cover_alt_text !== undefined
      ? (patch.cover_alt_text as string | null)
      : (existing?.cover_alt_text ?? null)
  if (effectiveCoverUrl && !effectiveCoverAltText) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cover alt text is required when cover artwork is present."
    )
  }
  if (!effectiveCoverUrl && effectiveCoverAltText) {
    patch.cover_alt_text = null
  }

  const effectiveDate =
    patch.release_date !== undefined
      ? (patch.release_date as Date | null)
      : existing?.release_date
  const effectiveYear =
    patch.release_year !== undefined
      ? (patch.release_year as number | null)
      : existing?.release_year
  validateDateAndYear(effectiveDate, effectiveYear)
  return patch
}

export const createManualDiscographyEntry = async (
  req: MedusaRequest,
  service: DiscographyService,
  input: ManualDiscographyCreateInput
) => {
  const actorId = requestActorId(req)
  const patch = buildManualPatch(input)
  const aggregateId = `new:${input.idempotencyKey}`
  const commandInput: DiscographyCommandInput = {
    aggregateId,
    command: "discography.entry.create-manual",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    payload: input,
  }
  return runDiscographyTransaction(service, async (sharedContext) => {
    const replayed = await replayCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: serializeDiscographyEntry(replayed), replayed: true }
    }
    const operation = await createOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const created = readAdminDiscographyMutation(
      await service.createDiscographyEntries(
        [
          {
            ...patch,
            archived_at: null,
            product_handle: null,
            product_id: null,
            source_mode: "manual",
            version: 1,
          },
        ],
        sharedContext
      ),
      { version: 1 }
    )
    await completeOperation(service, operation, created, sharedContext)
    return { entry: serializeDiscographyEntry(created), replayed: false }
  })
}

export const updateManualDiscographyEntry = async (
  req: MedusaRequest,
  service: DiscographyService,
  id: string,
  input: ManualDiscographyUpdateInput
) => {
  const actorId = requestActorId(req)
  const commandInput: DiscographyCommandInput = {
    aggregateId: id,
    command: "discography.entry.update-manual",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    payload: input,
  }
  return runDiscographyTransaction(service, async (sharedContext) => {
    const replayed = await replayCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: serializeDiscographyEntry(replayed), replayed: true }
    }
    const existing = await resolveEntry(service, id, sharedContext)
    if (existing.source_mode !== "manual") {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Linked store releases are synchronized from Products and cannot be edited here."
      )
    }
    if (existing.archived_at) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Restore the discography entry before editing it."
      )
    }
    if (existing.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The discography entry changed after it was loaded. Refresh before saving."
      )
    }
    const patch = buildManualPatch(input, existing)
    if (!Object.keys(patch).length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No discography changes were provided."
      )
    }
    const operation = await createOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const version = existing.version + 1
    const updated = readAdminDiscographyMutation(
      await service.updateDiscographyEntries(
        [{ id, ...patch, version }],
        sharedContext
      ),
      { id, version }
    )
    await completeOperation(service, operation, updated, sharedContext)
    return { entry: serializeDiscographyEntry(updated), replayed: false }
  })
}

export const setDiscographyEntryArchived = async (
  req: MedusaRequest,
  service: DiscographyService,
  id: string,
  input: DiscographyLifecycleInput,
  archived: boolean
) => {
  const actorId = requestActorId(req)
  const commandInput: DiscographyCommandInput = {
    aggregateId: id,
    command: archived
      ? "discography.entry.archive"
      : "discography.entry.restore",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  }
  return runDiscographyTransaction(service, async (sharedContext) => {
    const replayed = await replayCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: serializeDiscographyEntry(replayed), replayed: true }
    }
    const existing = await resolveEntry(service, id, sharedContext)
    if (existing.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The discography entry changed after it was loaded. Refresh before continuing."
      )
    }
    if (Boolean(existing.archived_at) === archived) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        archived
          ? "The discography entry is already archived."
          : "The discography entry is not archived."
      )
    }
    const operation = await createOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const version = existing.version + 1
    const updated = readAdminDiscographyMutation(
      await service.updateDiscographyEntries(
        [
          {
            archived_at: archived ? new Date() : null,
            id,
            version,
          },
        ],
        sharedContext
      ),
      { id, version }
    )
    await completeOperation(service, operation, updated, sharedContext)
    return { entry: serializeDiscographyEntry(updated), replayed: false }
  })
}
