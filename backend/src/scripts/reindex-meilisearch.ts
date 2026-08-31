import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { homedir } from "node:os"

import indexSettings from "../../config/meilisearch-settings.json"
import { writePrivateJsonArtifact } from "../lib/security/private-json-artifact"
import { assertConfiguredIndexSettings } from "./sync-meilisearch-settings"
import {
  loadProductIndexIdentity,
  validateProductIndex,
} from "./check-meilisearch-sync"
import {
  assertCandidateIndexName,
  createMeilisearchAdminClient,
  selectStaleCandidateIndexes,
  type MeilisearchTask,
} from "./meilisearch-admin-client"
import { resolveMeilisearchService } from "./meilisearch-service"

const PRODUCTS_INDEX = "products"
const BATCH_SIZE = 100
const TASK_TIMEOUT_MS = 120_000
const CANDIDATE_STABILITY_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000

type EnqueuedTask = MeilisearchTask

type CompletedTask = {
  status: string
  error?: unknown
}

type SearchIndex = {
  deleteAllDocuments: () => Promise<EnqueuedTask>
  deleteDocuments: (documentIds: string[]) => Promise<EnqueuedTask>
  getSettings: () => Promise<Record<string, unknown>>
  getStats: () => Promise<{ numberOfDocuments: number }>
  updateSettings: (settings: Record<string, unknown>) => Promise<EnqueuedTask>
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

export const waitForTask = async (
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
  indexKey = PRODUCTS_INDEX,
  reason,
}: {
  container: ExecArgs["container"]
  indexKey?: string
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
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const productFields = await meilisearch.getFieldsForType(PRODUCTS_INDEX)
  const index = meilisearch.getIndex(indexKey)
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
      indexKey,
      products,
      "products",
      { container }
    )
    await waitForTask(index, addTask, `batch at offset ${offset}`)
    offset += products.length
    totalIndexed += products.length
  }

  logger.info(
    `[meilisearch] Synchronized ${totalIndexed} product(s) into '${indexKey}' (${reason})`
  )
  return totalIndexed
}

const isIndexNotFound = (error: unknown): boolean => {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "index_not_found"
  )
}

const ensureIndexExists = async ({
  index,
  indexKey,
  meilisearch,
}: {
  index: SearchIndex
  indexKey: string
  meilisearch: {
    createIndex: (
      requestedIndexKey: string,
      options: Record<string, unknown>
    ) => Promise<EnqueuedTask>
  }
}): Promise<boolean> => {
  try {
    await index.getStats()
    return true
  } catch (error) {
    if (!isIndexNotFound(error)) {
      throw error
    }
  }

  const createTask = await meilisearch.createIndex(indexKey, {
    primaryKey: indexSettings.products.primaryKey,
  })
  await waitForTask(index, createTask, `create '${indexKey}'`)
  return false
}

type SearchRebuildCompletionReport = {
  candidateIndex: string
  completedAt: string
  durationMs: number
  indexedCount: number
  liveIndex: typeof PRODUCTS_INDEX
  liveValidation: {
    indexedCount: number
    publishedProductCount: number
  }
  prunedIndexes: string[]
  reconciliation: {
    removedCount: number
    upsertedCount: number
  }
  rollbackIndex: string
  stabilityPeriodDays: number
  startedAt: string
  swapTaskUid: number
}

export const writeCompletionReport = async (
  report: SearchRebuildCompletionReport
): Promise<string> => {
  const timestamp = new Date().toISOString().replaceAll(":", "-")
  return writePrivateJsonArtifact({
    baseDirectory: homedir(),
    fileName: `completed-${timestamp}.json`,
    relativeDirectory: ".local/share/remorseless-records/search-rebuild",
    value: report,
  })
}

const reconcileLiveProductIndex = async ({
  container,
  index,
}: {
  container: ExecArgs["container"]
  index: SearchIndex
}): Promise<{ removedCount: number; upsertedCount: number }> => {
  const upsertedCount = await upsertAllProductDocuments({
    container,
    indexKey: PRODUCTS_INDEX,
    reason: "post-swap write reconciliation",
  })
  const { indexedIds, publishedIds } = await loadProductIndexIdentity({
    container,
    indexKey: PRODUCTS_INDEX,
  })
  const published = new Set(publishedIds)
  const unexpectedIds = indexedIds.filter((id) => !published.has(id))

  if (unexpectedIds.length) {
    const deleteTask = await index.deleteDocuments(unexpectedIds)
    await waitForTask(
      index,
      deleteTask,
      `remove ${unexpectedIds.length} post-swap stale document(s)`
    )
  }

  return {
    removedCount: unexpectedIds.length,
    upsertedCount,
  }
}

export default async function reindexMeilisearch({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const candidateIndex = process.env.MEILISEARCH_CANDIDATE_INDEX?.trim() ?? ""
  assertCandidateIndexName(candidateIndex)

  const meilisearch = resolveMeilisearchService<{
    getIndex: (indexKey: string) => SearchIndex
    createIndex: (
      indexKey: string,
      options: Record<string, unknown>
    ) => Promise<EnqueuedTask>
    addDocuments: (
      indexKey: string,
      documents: unknown[],
      type?: string,
      options?: Record<string, unknown>
    ) => Promise<EnqueuedTask>
  }>(container)

  const host = process.env.MEILISEARCH_HOST?.trim() ?? ""
  const apiKey = process.env.MEILISEARCH_ADMIN_KEY?.trim() ?? ""
  const adminClient = createMeilisearchAdminClient({ apiKey, host })
  const candidate = meilisearch.getIndex(candidateIndex)
  const live = meilisearch.getIndex(PRODUCTS_INDEX)
  const productConfig = indexSettings.products
  const startedAt = new Date()

  logger.info(
    `[meilisearch] Building versioned candidate '${candidateIndex}' without modifying live search.`
  )

  const candidateAlreadyExisted = await ensureIndexExists({
    index: candidate,
    indexKey: candidateIndex,
    meilisearch,
  })
  if (candidateAlreadyExisted) {
    const clearTask = await candidate.deleteAllDocuments()
    await waitForTask(
      candidate,
      clearTask,
      `clear retry candidate '${candidateIndex}'`
    )
  }

  const settingsTask = await candidate.updateSettings(
    productConfig.indexSettings
  )
  await waitForTask(
    candidate,
    settingsTask,
    `apply settings to '${candidateIndex}'`
  )
  assertConfiguredIndexSettings({
    actual: await candidate.getSettings(),
    expected: productConfig.indexSettings,
    indexKey: candidateIndex,
  })

  const indexedCount = await upsertAllProductDocuments({
    container,
    indexKey: candidateIndex,
    reason: "zero-downtime full rebuild",
  })
  const candidateValidation = await validateProductIndex({
    container,
    indexKey: candidateIndex,
  })
  if (candidateValidation.indexedCount !== indexedCount) {
    throw new Error(
      `[meilisearch] Candidate validation counted ${candidateValidation.indexedCount} documents after indexing ${indexedCount}.`
    )
  }

  await ensureIndexExists({
    index: live,
    indexKey: PRODUCTS_INDEX,
    meilisearch,
  })
  const swapTask = await adminClient.swapIndexes(PRODUCTS_INDEX, candidateIndex)
  await waitForTask(live, swapTask, "atomic product-index swap")

  const reconciliation = await reconcileLiveProductIndex({
    container,
    index: live,
  })
  assertConfiguredIndexSettings({
    actual: await live.getSettings(),
    expected: productConfig.indexSettings,
    indexKey: PRODUCTS_INDEX,
  })
  const liveValidation = await validateProductIndex({
    container,
    indexKey: PRODUCTS_INDEX,
  })

  const protectedIndexes = new Set([PRODUCTS_INDEX, candidateIndex])
  const staleIndexes = selectStaleCandidateIndexes({
    indexes: await adminClient.listIndexes(),
    now: new Date(),
    protectedIndexes,
    stabilityPeriodMs: CANDIDATE_STABILITY_PERIOD_MS,
  })
  for (const staleIndex of staleIndexes) {
    const deleteTask = await adminClient.deleteIndex(staleIndex)
    await waitForTask(
      live,
      deleteTask,
      `delete stale candidate '${staleIndex}'`
    )
  }

  const completedAt = new Date()
  const report: SearchRebuildCompletionReport = {
    candidateIndex,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    indexedCount,
    liveIndex: PRODUCTS_INDEX,
    liveValidation,
    prunedIndexes: staleIndexes,
    reconciliation,
    rollbackIndex: candidateIndex,
    stabilityPeriodDays: 7,
    startedAt: startedAt.toISOString(),
    swapTaskUid: swapTask.taskUid,
  }
  const reportPath = await writeCompletionReport(report)
  logger.info(
    `[meilisearch] Atomic rebuild complete. '${PRODUCTS_INDEX}' is live; '${candidateIndex}' retains the prior index for rollback. Report: ${reportPath}`
  )
}
