import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { loadCatalogAuthoringAudit } from "@/lib/catalog/load-authoring-audit"

export default async function auditCatalogAuthoring({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const report = await loadCatalogAuthoringAudit(container)
  const blockingItems = report.items.filter(
    ({ status }) => status !== "classified"
  )

  logger.info(`[catalog-authoring-audit] ${JSON.stringify(report.summary)}`)
  for (const item of blockingItems.slice(0, 100)) {
    logger.error(
      `[catalog-authoring-audit] ${item.id} "${item.title}" ${item.status}: ${item.issues
        .filter(({ severity }) => severity !== "info")
        .map(({ code }) => code)
        .join(", ")}`
    )
  }

  if (blockingItems.length > 100) {
    logger.error(
      `[catalog-authoring-audit] ${blockingItems.length - 100} additional blocking item(s) omitted.`
    )
  }
  if (blockingItems.length > 0) {
    throw new Error(
      `[catalog-authoring-audit] ${blockingItems.length} product(s) require review before Admin cutover.`
    )
  }
}
