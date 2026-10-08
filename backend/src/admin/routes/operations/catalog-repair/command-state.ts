import { z } from "zod"

import { AdminRequestError } from "../../../lib/admin-request"
import {
  assertCurrentRepairResponse,
  fetchRepairActor,
  fetchRepairPreview,
  postRepair,
  repairBodySchema,
  repairContextSchema,
  repairPreviewSchema,
  repairResultSchema,
  sameIds,
  type RepairBody,
  type RepairContext,
  type RepairPreview,
  type RepairRequestOptions,
  type RepairResult,
} from "./query"

export const catalogRepairStorageKey = "remorseless-records.catalog-repair.v1"
const MAX_RECORD_BYTES = 128 * 1_024
type RepairStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
type RepairLocks = Pick<LockManager, "request">
export type RepairBoundary = RepairRequestOptions & {
  storage: RepairStorage
  locks: RepairLocks | undefined
}

const resultIdsSchema = repairResultSchema.shape.result.omit({
  creationOperationId: true,
  productId: true,
  manifestSha256: true,
})
type RepairBinding = {
  context: RepairContext
  body: RepairBody
  expectedIds: z.infer<typeof resultIdsSchema>
}
export const savedRepairSchema = z
  .object({
    version: z.literal(1),
    context: repairContextSchema,
    body: repairBodySchema,
    expectedIds: resultIdsSchema,
    status: z.enum(["uncertain", "succeeded"]),
    result: repairResultSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.context.productId === value.body.productId &&
      value.context.sha === value.body.sha &&
      (value.status === "succeeded") === (value.result !== null) &&
      (!value.result || resultMatches(value, value.result))
  )
export type SavedRepair = z.infer<typeof savedRepairSchema>
export type RepairAttempt = { record: SavedRepair; error?: unknown }

export const scheduleRepairRestore = async (
  isCurrent: () => boolean,
  restore: () => Promise<void>
): Promise<void> => {
  // Native React may replay an initial effect with cleanup before the next
  // mount. Let that cleanup invalidate the obsolete callback before it can
  // acquire this tab's own shared lock. Only the read-only restore is deferred.
  await Promise.resolve()
  if (isCurrent()) await restore()
}

const resultMatches = (record: RepairBinding, reply: RepairResult): boolean =>
  reply.result.creationOperationId === record.context.creationOperationId &&
  reply.result.productId === record.context.productId &&
  reply.result.manifestSha256 === record.body.expectedManifestSha256 &&
  reply.result.profileId === record.expectedIds.profileId &&
  sameIds(
    reply.result.variantProfileIds,
    record.expectedIds.variantProfileIds
  ) &&
  sameIds(reply.result.mediaLinkIds, record.expectedIds.mediaLinkIds) &&
  sameIds(reply.result.retainedAssetIds, record.expectedIds.retainedAssetIds)

const immutableIdentity = (record: SavedRepair): string =>
  JSON.stringify({
    context: record.context,
    body: record.body,
    expectedIds: record.expectedIds,
  })

export const readSavedRepair = (storage: RepairStorage): SavedRepair | null => {
  const raw = storage.getItem(catalogRepairStorageKey)
  if (raw === null) return null
  if (new TextEncoder().encode(raw).length > MAX_RECORD_BYTES)
    throw new Error("The saved repair request could not be verified.")
  // An invalid or old record may still represent a sent command. Never delete
  // or expire it automatically, and never replace it with a new UUID.
  const payload: unknown = JSON.parse(raw)
  return savedRepairSchema.parse(payload)
}

export const saveRepair = (
  storage: RepairStorage,
  record: SavedRepair
): void => {
  const parsed = savedRepairSchema.parse(record)
  const existing = readSavedRepair(storage)
  if (existing && immutableIdentity(existing) !== immutableIdentity(parsed))
    throw new Error(
      "Another repair request is already saved. Keep that request."
    )
  if (existing?.status === "succeeded" && parsed.status !== "succeeded")
    throw new Error("The confirmed repair cannot become an uncertain request.")
  const serialized = JSON.stringify(parsed)
  if (new TextEncoder().encode(serialized).length > MAX_RECORD_BYTES)
    throw new Error("The repair request is too large to save safely.")
  storage.setItem(catalogRepairStorageKey, serialized)
  if (storage.getItem(catalogRepairStorageKey) !== serialized)
    throw new Error("The repair request could not be saved. Nothing was sent.")
}

export const withRepairLock = async <T>(
  locks: RepairLocks | undefined,
  operation: () => Promise<T>
): Promise<T> => {
  if (!locks?.request)
    throw new Error("This browser cannot safely coordinate repair requests.")
  return locks.request(
    catalogRepairStorageKey,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Another tab is working on this repair. Try again later."
        )
      return operation()
    }
  )
}

const assertOwner = (
  record: SavedRepair,
  backendOrigin: string,
  actorId: string
): void => {
  if (
    record.context.backendOrigin !== backendOrigin ||
    record.body.expectedActorId !== actorId
  )
    throw new Error(
      "The saved repair belongs to another server or administrator. Return to its original session to recover it."
    )
}

export const restoreRepair = async (
  backendOrigin: string,
  boundary: RepairBoundary
): Promise<SavedRepair | null> =>
  withRepairLock(boundary.locks, async () => {
    const actorId = await fetchRepairActor(boundary)
    const record = readSavedRepair(boundary.storage)
    if (record) assertOwner(record, backendOrigin, actorId)
    assertCurrentRepairResponse(boundary)
    return record
  })

export const previewRepair = async (
  context: RepairContext,
  boundary: RepairBoundary
): Promise<RepairPreview> =>
  withRepairLock(boundary.locks, async () => {
    if (readSavedRepair(boundary.storage))
      throw new Error(
        "A repair request is saved. Recover it before previewing another."
      )
    return fetchRepairPreview(context, boundary)
  })

const attempt = async (
  record: SavedRepair,
  boundary: RepairBoundary
): Promise<RepairAttempt> => {
  try {
    const result = await postRepair(record.context, record.body, boundary)
    if (!resultMatches(record, result))
      throw new AdminRequestError(
        "The repair acknowledgment does not match the saved request.",
        "invalid-response"
      )
    const confirmed: SavedRepair = { ...record, status: "succeeded", result }
    saveRepair(boundary.storage, confirmed)
    return { record: confirmed }
  } catch (error) {
    // Even a retry's 401/403/409/429 can follow a previously completed command.
    // Only a validated matching acknowledgment resolves that uncertainty.
    return { record, error }
  }
}

export const beginRepair = async (
  context: RepairContext,
  preview: RepairPreview,
  boundary: RepairBoundary,
  uuid: () => string = () => crypto.randomUUID()
): Promise<RepairAttempt> =>
  withRepairLock(boundary.locks, async () => {
    const parsed = repairContextSchema.parse(context)
    const reviewed = repairPreviewSchema.parse(preview)
    const actorId = await fetchRepairActor(boundary)
    const existing = readSavedRepair(boundary.storage)
    if (existing) {
      assertOwner(existing, parsed.backendOrigin, actorId)
      // Another tab won the first attempt. Show its saved plan before allowing
      // an explicit retry; do not silently send or generate a second UUID.
      return { record: existing }
    }
    if (
      actorId !== reviewed.actorId ||
      parsed.productId !== reviewed.manifest.productId ||
      parsed.creationOperationId !== reviewed.manifest.creationOperationId
    )
      throw new Error("Your session or repair target changed. Preview again.")
    assertCurrentRepairResponse(boundary)
    const record: SavedRepair = savedRepairSchema.parse({
      version: 1,
      context: parsed,
      body: {
        productId: parsed.productId,
        sha: parsed.sha,
        expectedActorId: actorId,
        expectedManifestSha256: reviewed.manifestSha256,
        idempotencyKey: uuid(),
      },
      expectedIds: {
        profileId: reviewed.manifest.profile.id,
        variantProfileIds: reviewed.manifest.variants.map((row) => row.id),
        mediaLinkIds: reviewed.manifest.media.map((row) => row.id),
        retainedAssetIds: reviewed.manifest.assets.map((row) => row.id),
      },
      status: "uncertain",
      result: null,
    })
    // Persist and verify the exact immutable body before the first network
    // mutation. A crash, reload or closed tab leaves this recovery identity.
    saveRepair(boundary.storage, record)
    return attempt(record, boundary)
  })

export const retryRepair = async (
  expected: SavedRepair,
  backendOrigin: string,
  boundary: RepairBoundary
): Promise<RepairAttempt> =>
  withRepairLock(boundary.locks, async () => {
    const actorId = await fetchRepairActor(boundary)
    const record = readSavedRepair(boundary.storage)
    if (!record || immutableIdentity(record) !== immutableIdentity(expected))
      throw new Error(
        "The saved repair request changed. Reload its saved state."
      )
    assertOwner(record, backendOrigin, actorId)
    assertCurrentRepairResponse(boundary)
    if (record.status === "succeeded") return { record }
    // No GET preview here: a completed repair has already soft-deleted rows.
    return attempt(record, boundary)
  })

export const clearConfirmedRepair = async (
  expected: SavedRepair,
  backendOrigin: string,
  boundary: RepairBoundary
): Promise<void> =>
  withRepairLock(boundary.locks, async () => {
    const actorId = await fetchRepairActor(boundary)
    const record = readSavedRepair(boundary.storage)
    if (
      !record ||
      record.status !== "succeeded" ||
      immutableIdentity(record) !== immutableIdentity(expected)
    )
      throw new Error("Only a confirmed repair can be cleared.")
    assertOwner(record, backendOrigin, actorId)
    assertCurrentRepairResponse(boundary)
    boundary.storage.removeItem(catalogRepairStorageKey)
    if (readSavedRepair(boundary.storage))
      throw new Error("The confirmed repair could not be cleared.")
  })
