import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  assertExactNewsEntry,
  readAdminNewsMutation,
} from "@/lib/content/persistence-contracts"
import { serializeNewsEntry } from "@/modules/news/serializers"
import {
  completeNewsOperation,
  createNewsOperation,
  type NewsCommandInput,
  type NewsService,
  replayNewsCommand,
  requestNewsActorId,
  resolveNewsEntry,
  runNewsTransaction,
  verifyNewsCommandPersistence,
} from "./command"
import type {
  NewsCreateInput,
  NewsLifecycleInput,
  NewsUpdateInput,
} from "./contracts"
import { buildNewsEntryPatch, resolveUniqueNewsSlug } from "./entry-payload"
import { resolveAdminUserName } from "./utils"

export {
  newsCreateSchema,
  newsLifecycleSchema,
  newsUpdateSchema,
} from "./contracts"
export type { NewsService } from "./command"

export const createNewsEntry = async (
  req: MedusaRequest,
  service: NewsService,
  input: NewsCreateInput
) => {
  const actorId = requestNewsActorId(req)
  const aggregateId = `new:${input.idempotencyKey}`
  const commandInput: NewsCommandInput = {
    aggregateId,
    command: "news.entry.create",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    payload: input,
  }
  return runNewsTransaction(service, async (sharedContext) => {
    const replayed = await replayNewsCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: replayed, replayed: true }
    }
    const author = await resolveAdminUserName(req)
    const operation = await createNewsOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const patch = buildNewsEntryPatch({ input, now: new Date() })
    const slug = await resolveUniqueNewsSlug(
      service,
      input.title,
      input.idempotencyKey,
      sharedContext
    )
    const createdAcknowledgement = readAdminNewsMutation(
      await service.createNewsEntries(
        [
          {
            ...patch,
            archived_at: null,
            author,
            slug,
            version: 1,
          },
        ],
        sharedContext
      ),
      { version: 1 }
    )
    const created = assertExactNewsEntry(createdAcknowledgement, {
      ...createdAcknowledgement,
      ...patch,
      archived_at: null,
      author,
      slug,
      version: 1,
    } as typeof createdAcknowledgement)
    const completed = await completeNewsOperation(
      service,
      operation,
      created,
      sharedContext
    )
    const durable = await verifyNewsCommandPersistence(
      service,
      completed,
      created,
      sharedContext
    )
    return { entry: serializeNewsEntry(durable), replayed: false }
  })
}

export const updateNewsEntry = async (
  req: MedusaRequest,
  service: NewsService,
  id: string,
  input: NewsUpdateInput
) => {
  const actorId = requestNewsActorId(req)
  const { expectedVersion, idempotencyKey, ...requestedChanges } = input
  if (!Object.keys(requestedChanges).length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No news changes were provided."
    )
  }
  const commandInput: NewsCommandInput = {
    aggregateId: id,
    command: "news.entry.update",
    expectedVersion,
    idempotencyKey,
    payload: input,
  }
  return runNewsTransaction(service, async (sharedContext) => {
    const replayed = await replayNewsCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: replayed, replayed: true }
    }
    const existing = await resolveNewsEntry(service, id, sharedContext)
    if (existing.archived_at || existing.status === "archived") {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Restore the news post before editing it."
      )
    }
    if (existing.version !== expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The news post changed after it was loaded. Refresh before saving."
      )
    }
    const operation = await createNewsOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const patch = buildNewsEntryPatch({ existing, input, now: new Date() })
    const version = existing.version + 1
    const updatedAcknowledgement = readAdminNewsMutation(
      await service.updateNewsEntries(
        [{ id, ...patch, version }],
        sharedContext
      ),
      { id, version }
    )
    const updated = assertExactNewsEntry(updatedAcknowledgement, {
      ...existing,
      ...patch,
      id,
      updated_at: updatedAcknowledgement.updated_at ?? null,
      version,
    } as typeof updatedAcknowledgement)
    const completed = await completeNewsOperation(
      service,
      operation,
      updated,
      sharedContext
    )
    const durable = await verifyNewsCommandPersistence(
      service,
      completed,
      updated,
      sharedContext
    )
    return { entry: serializeNewsEntry(durable), replayed: false }
  })
}

export const setNewsEntryArchived = async (
  req: MedusaRequest,
  service: NewsService,
  id: string,
  input: NewsLifecycleInput,
  archived: boolean
) => {
  const actorId = requestNewsActorId(req)
  const commandInput: NewsCommandInput = {
    aggregateId: id,
    command: archived ? "news.entry.archive" : "news.entry.restore",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
  }
  return runNewsTransaction(service, async (sharedContext) => {
    const replayed = await replayNewsCommand(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    if (replayed) {
      return { entry: replayed, replayed: true }
    }
    const existing = await resolveNewsEntry(service, id, sharedContext)
    if (existing.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The news post changed after it was loaded. Refresh before continuing."
      )
    }
    if (Boolean(existing.archived_at) === archived) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        archived
          ? "The news post is already archived."
          : "The news post is not archived."
      )
    }
    const operation = await createNewsOperation(
      service,
      actorId,
      commandInput,
      sharedContext
    )
    const version = existing.version + 1
    const archivedAt = archived ? new Date() : null
    const nextStatus =
      existing.status === "archived" ? "draft" : existing.status
    const updatedAcknowledgement = readAdminNewsMutation(
      await service.updateNewsEntries(
        [
          {
            archived_at: archivedAt,
            id,
            status: nextStatus,
            version,
          },
        ],
        sharedContext
      ),
      { id, version }
    )
    const updated = assertExactNewsEntry(updatedAcknowledgement, {
      ...existing,
      archived_at: archivedAt,
      id,
      status: nextStatus,
      updated_at: updatedAcknowledgement.updated_at ?? null,
      version,
    })
    const completed = await completeNewsOperation(
      service,
      operation,
      updated,
      sharedContext
    )
    const durable = await verifyNewsCommandPersistence(
      service,
      completed,
      updated,
      sharedContext
    )
    return { entry: serializeNewsEntry(durable), replayed: false }
  })
}
