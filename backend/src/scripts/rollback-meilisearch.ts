import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  assertCandidateIndexName,
  createMeilisearchAdminClient,
  type MeilisearchTask,
} from "./meilisearch-admin-client"
import { resolveMeilisearchService } from "./meilisearch-service"
import { assertTaskSucceeded } from "./reindex-meilisearch"

const PRODUCTS_INDEX = "products"
const TASK_TIMEOUT_MS = 120_000

type SearchIndex = {
  getStats: () => Promise<{ numberOfDocuments: number }>
  tasks: {
    waitForTask: (
      task: MeilisearchTask,
      options: { timeout: number; interval: number }
    ) => Promise<{ error?: unknown; status: string }>
  }
}

export const assertRollbackConfirmation = ({
  confirmation,
  rollbackIndex,
}: {
  confirmation: string
  rollbackIndex: string
}): void => {
  assertCandidateIndexName(rollbackIndex)
  if (confirmation !== rollbackIndex) {
    throw new Error(
      "[meilisearch] Set MEILISEARCH_ROLLBACK_CONFIRM to the exact rollback index UID."
    )
  }
}

export default async function rollbackMeilisearch({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const rollbackIndex =
    process.env.MEILISEARCH_ROLLBACK_INDEX?.trim() ?? ""
  const confirmation =
    process.env.MEILISEARCH_ROLLBACK_CONFIRM?.trim() ?? ""
  assertRollbackConfirmation({ confirmation, rollbackIndex })

  const meilisearch = resolveMeilisearchService<{
    getIndex: (indexKey: string) => SearchIndex
  }>(container)
  const live = meilisearch.getIndex(PRODUCTS_INDEX)
  const rollback = meilisearch.getIndex(rollbackIndex)
  const [liveStats, rollbackStats] = await Promise.all([
    live.getStats(),
    rollback.getStats(),
  ])
  if (rollbackStats.numberOfDocuments <= 0) {
    throw new Error(
      `[meilisearch] Rollback index '${rollbackIndex}' has no documents.`
    )
  }

  logger.warn(
    `[meilisearch] Rolling back '${PRODUCTS_INDEX}' (${liveStats.numberOfDocuments} documents) to '${rollbackIndex}' (${rollbackStats.numberOfDocuments} documents).`
  )
  const adminClient = createMeilisearchAdminClient({
    apiKey: process.env.MEILISEARCH_ADMIN_KEY?.trim() ?? "",
    host: process.env.MEILISEARCH_HOST?.trim() ?? "",
  })
  const swapTask = await adminClient.swapIndexes(
    PRODUCTS_INDEX,
    rollbackIndex
  )
  const completed = await live.tasks.waitForTask(swapTask, {
    timeout: TASK_TIMEOUT_MS,
    interval: 100,
  })
  assertTaskSucceeded(completed, "rollback index swap")

  const restoredStats = await live.getStats()
  if (restoredStats.numberOfDocuments !== rollbackStats.numberOfDocuments) {
    throw new Error(
      `[meilisearch] Rollback verification expected ${rollbackStats.numberOfDocuments} documents but found ${restoredStats.numberOfDocuments}.`
    )
  }
  logger.warn(
    `[meilisearch] Rollback complete. '${PRODUCTS_INDEX}' now contains ${restoredStats.numberOfDocuments} documents.`
  )
}
