import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { loadCatalogAuthoringAudit } from "@/lib/catalog/load-authoring-audit"
import { loadProductAuthoringView } from "@/lib/catalog/product-authoring-view"

const hasDiagnosticsBlocker = (
  view: Awaited<ReturnType<typeof loadProductAuthoringView>>
): boolean =>
  view.diagnostics.duplicateBundleProfileIds.length > 0 ||
  view.diagnostics.duplicateProductProfileIds.length > 0 ||
  view.diagnostics.inventoryAvailability !== "available" ||
  view.diagnostics.missingArtistIds.length > 0 ||
  view.diagnostics.missingMediaAssetIds.length > 0 ||
  view.diagnostics.missingReferenceValueIds.length > 0 ||
  view.diagnostics.missingVariantProfileIds.length > 0 ||
  view.diagnostics.orphanVariantProfileIds.length > 0

export default async function checkCatalogAuthoringViews({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const audit = await loadCatalogAuthoringAudit(container)
  if (audit.summary.blockingItemCount > 0) {
    throw new Error(
      "[catalog-authoring-view-check] Classification blockers must be resolved first."
    )
  }

  const startedAt = Date.now()
  const batchSize = 8
  const checkedByKind: Record<string, number> = {}
  let checkedCount = 0
  let variantCount = 0

  for (let offset = 0; offset < audit.items.length; offset += batchSize) {
    const items = audit.items.slice(offset, offset + batchSize)
    const views = await Promise.all(
      items.map((item) => loadProductAuthoringView(container, item.id))
    )
    for (const [index, view] of views.entries()) {
      const item = items[index]!
      if (
        !item.kind ||
        view.commerce.id !== item.id ||
        view.classification.kind !== item.kind ||
        view.classification.status !== "classified" ||
        hasDiagnosticsBlocker(view)
      ) {
        throw new Error(
          `[catalog-authoring-view-check] ${item.id} failed the complete ${item.kind ?? "unknown"} check.`
        )
      }
      checkedByKind[item.kind] = (checkedByKind[item.kind] ?? 0) + 1
      checkedCount += 1
      variantCount += view.commerce.variants.length
    }
  }

  logger.info(
    `[catalog-authoring-view-check] ${JSON.stringify({
      batchSize,
      checkedByKind,
      count: checkedCount,
      durationMs: Date.now() - startedAt,
      variantCount,
    })}`
  )
}
