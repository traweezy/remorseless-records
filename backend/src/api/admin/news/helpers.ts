import type { MedusaRequest } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import {
  type NewsEntryRecord,
  serializeNewsEntry,
} from "@/modules/news/serializers"
import {
  completeNewsOperation,
  createNewsOperation,
  type NewsCommandInput,
  type NewsService,
  replayNewsCommand,
  requestNewsActorId,
  resolveNewsEntry,
  runNewsTransaction,
} from "./command"
import type {
  NewsCreateInput,
  NewsLifecycleInput,
  NewsUpdateInput,
} from "./contracts"
import {
  buildNewsEntryPatch,
  resolveUniqueNewsSlug,
} from "./entry-payload"
import { resolveAdminUserName } from "./utils"

export {
  newsCreateSchema,
  newsLifecycleSchema,
  newsUpdateSchema,
} from "./contracts"
export type { NewsService } from "./command"

const firstResult = <T>(value: T | T[]): T | undefined =>
  Array.isArray(value) ? value[0] : value

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
    const created = firstResult(
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
      )
    ) as NewsEntryRecord | undefined
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to create news post."
      )
    }
    await completeNewsOperation(service, operation.id, created, sharedContext)
    return { entry: serializeNewsEntry(created), replayed: false }
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
    const updated = firstResult(
      await service.updateNewsEntries(
        [{ id, ...patch, version }],
        sharedContext
      )
    ) as NewsEntryRecord | undefined
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to update news post."
      )
    }
    await completeNewsOperation(service, operation.id, updated, sharedContext)
    return { entry: serializeNewsEntry(updated), replayed: false }
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
    const updated = firstResult(
      await service.updateNewsEntries(
        [
          {
            archived_at: archived ? new Date() : null,
            id,
            status: existing.status === "archived" ? "draft" : existing.status,
            version,
          },
        ],
        sharedContext
      )
    ) as NewsEntryRecord | undefined
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        archived ? "Unable to archive news post." : "Unable to restore news post."
      )
    }
    await completeNewsOperation(service, operation.id, updated, sharedContext)
    return { entry: serializeNewsEntry(updated), replayed: false }
  })
}
