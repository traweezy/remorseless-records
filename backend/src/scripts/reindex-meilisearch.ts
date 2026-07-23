import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"

import { resolveMeilisearchService } from "./meilisearch-service"

const PRODUCTS_INDEX = "products"
const BATCH_SIZE = 100
const TASK_TIMEOUT_MS = 120_000

type EnqueuedTask = {
  taskUid: number
}

type CompletedTask = {
  status: string
  error?: unknown
}

type SearchIndex = {
  tasks: {
    waitForTask: (
      task: EnqueuedTask,
      options: { timeout: number; interval: number }
    ) => Promise<CompletedTask>
  }
}

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { skip?: number; take?: number }
  }) => Promise<{ data: Array<Record<string, unknown>> }>
}

export const assertTaskSucceeded = (
  task: CompletedTask,
  operation: string
): void => {
  if (task.status !== "succeeded") {
    const detail = task.error ? `: ${JSON.stringify(task.error)}` : ""
    throw new Error(`[meilisearch] ${operation} ${task.status}${detail}`)
  }
}

const waitForTask = async (
  index: SearchIndex,
  task: EnqueuedTask,
  operation: string
): Promise<void> => {
  const completed = await index.tasks.waitForTask(task, {
    timeout: TASK_TIMEOUT_MS,
    interval: 100,
  })
  assertTaskSucceeded(completed, operation)
}

export const upsertAllProductDocuments = async ({
  container,
  reason,
}: {
  container: ExecArgs["container"]
  reason: string
}): Promise<number> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const meilisearch = resolveMeilisearchService<{
    getIndex: (indexKey: string) => SearchIndex
    getFieldsForType: (type: string) => Promise<string[]>
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      type?: string,
      options?: Record<string, unknown>
    ) => Promise<EnqueuedTask>
  }>(container)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const productFields = await meilisearch.getFieldsForType(PRODUCTS_INDEX)
  const index = meilisearch.getIndex(PRODUCTS_INDEX)
  let offset = 0
  let totalIndexed = 0

  logger.info(`[meilisearch] Synchronizing product documents (${reason})…`)
  while (true) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: productFields,
      filters: { status: ProductStatus.PUBLISHED },
      pagination: { skip: offset, take: BATCH_SIZE },
    })
    if (!products.length) {
      break
    }

    const addTask = await meilisearch.addDocuments(
      PRODUCTS_INDEX,
      products,
      "products",
      { container }
    )
    await waitForTask(index, addTask, `batch at offset ${offset}`)
    offset += products.length
    totalIndexed += products.length
  }

  logger.info(
    `[meilisearch] Synchronized ${totalIndexed} product(s) (${reason})`
  )
  return totalIndexed
}

export default async function reindexMeilisearch({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meilisearch = resolveMeilisearchService<{
    getIndex: (indexKey: string) => SearchIndex
    deleteAllDocuments: (indexKey: string) => Promise<EnqueuedTask>
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      type?: string,
      options?: Record<string, unknown>
    ) => Promise<EnqueuedTask>
  }>(container)

  logger.info("[meilisearch] Rebuilding product index…")

  const index = meilisearch.getIndex(PRODUCTS_INDEX)
  const deleteTask = await meilisearch.deleteAllDocuments(PRODUCTS_INDEX)
  await waitForTask(index, deleteTask, "document deletion")

  await upsertAllProductDocuments({ container, reason: "full rebuild" })
}
