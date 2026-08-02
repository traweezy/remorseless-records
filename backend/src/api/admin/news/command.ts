import type { MedusaRequest } from "@medusajs/framework"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
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

const firstResult = <T>(value: T | T[]): T | undefined =>
  Array.isArray(value) ? value[0] : value

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

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
  const entry = (await service.retrieveNewsEntry(
    id,
    {},
    sharedContext
  )) as NewsEntryRecord | null
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
  const operation = (
    await service.listNewsOperations(
      { idempotency_key: input.idempotencyKey },
      { take: 1 },
      sharedContext
    )
  )[0]
  if (!operation) {
    return null
  }
  const sameCommand =
    operation.aggregate_id === input.aggregateId &&
    operation.command === input.command &&
    operation.actor_id === actorId &&
    operation.expected_version === input.expectedVersion &&
    operation.request_sha256 === requestSha256 &&
    operation.status === "succeeded"
  if (!sameCommand) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The news idempotency key cannot be replayed for this command."
    )
  }
  const entry = asRecord(asRecord(operation.result).entry)
  if (typeof entry.id !== "string" || typeof entry.version !== "number") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The completed news command has no post response."
    )
  }
  return entry as NewsEntryDTO
}

export const createNewsOperation = async (
  service: NewsService,
  actorId: string | null,
  input: NewsCommandInput,
  sharedContext: NewsTransactionContext
) => {
  const created = firstResult(
    await service.createNewsOperations(
      [
        {
          actor_id: actorId,
          aggregate_id: input.aggregateId,
          command: input.command,
          expected_version: input.expectedVersion,
          idempotency_key: input.idempotencyKey,
          metadata: {},
          request_sha256: hashCatalogCommand({
            aggregateId: input.aggregateId,
            command: input.command,
            expectedVersion: input.expectedVersion,
            payload: input.payload ?? {},
          }),
          result: {},
          status: "pending",
        },
      ],
      sharedContext
    )
  )
  if (!created) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The news command audit record was not created."
    )
  }
  return created
}

export const completeNewsOperation = async (
  service: NewsService,
  operationId: string,
  entry: NewsEntryRecord,
  sharedContext: NewsTransactionContext
): Promise<void> => {
  const response = serializeNewsEntry(entry)
  await service.updateNewsOperations(
    [
      {
        completed_at: new Date(),
        id: operationId,
        result: { entry: response, entryId: entry.id, version: entry.version },
        status: "succeeded",
      },
    ],
    sharedContext
  )
}
