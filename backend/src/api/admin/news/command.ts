import type { MedusaRequest } from "@medusajs/framework"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import {
  assertExactNewsEntry,
  readAdminNewsEntry,
  readContentOperationList,
  readContentOperationMutation,
  readExactNewsOperationResult,
  readNewsOperationResult,
  type ContentOperationProjection,
} from "@/lib/content/persistence-contracts"
import type NewsModuleService from "@/modules/news/service"
import {
  type NewsEntryDTO,
  type NewsEntryRecord,
  serializeNewsEntry,
} from "@/modules/news/serializers"

export type NewsService = InstanceType<typeof NewsModuleService>
export type NewsTransactionContext = Context<EntityManager>

export type NewsCommandInput = {
  aggregateId: string
  command: string
  expectedVersion: number
  idempotencyKey: string
  payload?: unknown
}

export const requestNewsActorId = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null }
    }
  ).auth_context?.actor_id ?? null

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
      candidate.code === "23505" ||
      candidate.code === "40001" ||
      candidate.code === "40P01" ||
      (typeof candidate.message === "string" &&
        /could not serialize|deadlock detected|unique constraint/i.test(
          candidate.message
        ))
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

export const runNewsTransaction = async <T>(
  service: NewsService,
  task: (sharedContext: NewsTransactionContext) => Promise<T>
): Promise<T> => {
  try {
    return await service.runNewsTransaction(task)
  } catch (error) {
    if (hasTransactionConflict(error)) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The news post changed while it was being saved. Refresh and retry the same request."
      )
    }
    throw error
  }
}

export const resolveNewsEntry = async (
  service: NewsService,
  id: string,
  sharedContext?: NewsTransactionContext
): Promise<NewsEntryRecord> => {
  const entry = readAdminNewsEntry(
    await service.retrieveNewsEntry(id, {}, sharedContext),
    id
  )
  if (!entry) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "News post not found")
  }
  return entry
}

export const replayNewsCommand = async (
  service: NewsService,
  actorId: string | null,
  input: NewsCommandInput,
  sharedContext: NewsTransactionContext
): Promise<NewsEntryDTO | null> => {
  const requestSha256 = hashCatalogCommand({
    aggregateId: input.aggregateId,
    command: input.command,
    expectedVersion: input.expectedVersion,
    payload: input.payload ?? {},
  })
  const operation = readContentOperationList(
    await service.listNewsOperations(
      { idempotency_key: input.idempotencyKey },
      { take: 2 },
      sharedContext
    ),
    "news"
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
      "The news idempotency key cannot be replayed for this command."
    )
  }
  return readNewsOperationResult(operation.result)
}

export const createNewsOperation = async (
  service: NewsService,
  actorId: string | null,
  input: NewsCommandInput,
  sharedContext: NewsTransactionContext
): Promise<ContentOperationProjection> => {
  const requestSha256 = hashCatalogCommand({
    aggregateId: input.aggregateId,
    command: input.command,
    expectedVersion: input.expectedVersion,
    payload: input.payload ?? {},
  })
  return readContentOperationMutation(
    await service.createNewsOperations(
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
      kind: "news",
      requestSha256,
      status: "pending",
    }
  )
}

export const completeNewsOperation = async (
  service: NewsService,
  operation: ContentOperationProjection,
  entry: NewsEntryRecord,
  sharedContext: NewsTransactionContext
): Promise<ContentOperationProjection> => {
  const response = serializeNewsEntry(entry)
  const completed = readContentOperationMutation(
    await service.updateNewsOperations(
      [
        {
          completed_at: new Date(),
          id: operation.id,
          result: {
            entry: response,
            entryId: entry.id,
            version: entry.version,
          },
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
      kind: "news",
      requestSha256: operation.requestSha256,
      status: "succeeded",
    }
  )
  readExactNewsOperationResult(completed.result, response)
  return completed
}

export const verifyNewsCommandPersistence = async (
  service: NewsService,
  operation: ContentOperationProjection,
  entry: NewsEntryRecord,
  sharedContext: NewsTransactionContext
): Promise<NewsEntryRecord> => {
  const durableEntry = assertExactNewsEntry(
    await resolveNewsEntry(service, entry.id, sharedContext),
    entry
  )
  const durableOperation = readContentOperationList(
    await service.listNewsOperations(
      { idempotency_key: operation.idempotencyKey },
      { take: 2 },
      sharedContext
    ),
    "news"
  )
  if (
    !durableOperation ||
    durableOperation.id !== operation.id ||
    durableOperation.actorId !== operation.actorId ||
    durableOperation.aggregateId !== operation.aggregateId ||
    durableOperation.command !== operation.command ||
    durableOperation.expectedVersion !== operation.expectedVersion ||
    durableOperation.idempotencyKey !== operation.idempotencyKey ||
    durableOperation.requestSha256 !== operation.requestSha256 ||
    durableOperation.status !== "succeeded"
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The completed news command did not persist its exact audit state."
    )
  }
  readExactNewsOperationResult(
    durableOperation.result,
    serializeNewsEntry(durableEntry)
  )
  return durableEntry
}
