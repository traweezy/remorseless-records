import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
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

const productRelations = [
  "collection",
  "tags",
  "images",
  "metadata",
  "variants",
  "variants.prices",
  "variants.options",
  "variants.options.option",
  "options",
  "options.values",
  "categories",
  "categories.parent_category",
  "categories.parent_category.parent_category",
]

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
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      type?: string,
      options?: Record<string, unknown>
    ) => Promise<EnqueuedTask>
  }>(container)
  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: {
        relations?: string[]
        skip?: number
        take?: number
      }
    ) => Promise<[unknown[], number]>
  }
  const index = meilisearch.getIndex(PRODUCTS_INDEX)
  let offset = 0
  let totalIndexed = 0

  logger.info(`[meilisearch] Synchronizing product documents (${reason})…`)
  while (true) {
    const [products] = await productModuleService.listAndCountProducts(
      {},
      {
        relations: productRelations,
        skip: offset,
        take: BATCH_SIZE,
      }
    )
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
