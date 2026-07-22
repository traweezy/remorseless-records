import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"

import { clearAutomaticShelfCache } from "@/lib/meilisearch/product-transformer"
import { upsertAllProductDocuments } from "@/scripts/reindex-meilisearch"

type CatalogShelfChangedData = {
  shelfId: string
}

export default async function catalogShelfChangedHandler({
  event: { data },
  container,
}: SubscriberArgs<CatalogShelfChangedData>): Promise<void> {
  clearAutomaticShelfCache()
  await upsertAllProductDocuments({
    container,
    reason: `catalog shelf ${data.shelfId} changed`,
  })
}

export const config: SubscriberConfig = {
  event: "catalog.shelf.changed",
}
