import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import { resolveMeilisearchService } from "./meilisearch-service"

const PRODUCTS_INDEX = "products"
const DOCUMENT_PAGE_SIZE = 1_000
const REQUIRED_DOCUMENT_FIELDS = [
  "id",
  "handle",
  "status",
  "title",
  "artist_sort",
  "product_type",
  "stock_status",
] as const

type CatalogReadModelIntegrity = {
  contradictoryStockCount: number
  nonPublishedCount: number
  unknownStockCount: number
}

export const assertCatalogReadModelIntegrity = ({
  contradictoryStockCount,
  nonPublishedCount,
  unknownStockCount,
}: CatalogReadModelIntegrity): void => {
  if (nonPublishedCount > 0) {
    throw new Error(
      `[meilisearch] ${nonPublishedCount} non-published product(s) are exposed in the catalog index.`
    )
  }
  if (contradictoryStockCount > 0) {
    throw new Error(
      `[meilisearch] ${contradictoryStockCount} published product(s) are marked sold out while also reporting available variants.`
    )
  }
  if (unknownStockCount > 0) {
    throw new Error(
      `[meilisearch] ${unknownStockCount} published product(s) have unknown stock after a full reindex.`
    )
  }
}

export const assertPublishedProductParity = ({
  indexedCount,
  publishedProductCount,
}: {
  indexedCount: number
  publishedProductCount: number
}): void => {
  if (publishedProductCount !== indexedCount) {
    throw new Error(
      `[meilisearch] Published product count in Medusa (${publishedProductCount}) does not match indexed documents (${indexedCount}).`
    )
  }
}

export const assertExactDocumentIds = ({
  indexedIds,
  publishedIds,
}: {
  indexedIds: string[]
  publishedIds: string[]
}): void => {
  const indexed = new Set(indexedIds)
  const published = new Set(publishedIds)
  const missing = publishedIds.filter((id) => !indexed.has(id))
  const unexpected = indexedIds.filter((id) => !published.has(id))

  if (
    indexed.size !== indexedIds.length ||
    published.size !== publishedIds.length ||
    missing.length ||
    unexpected.length
  ) {
    throw new Error(
      `[meilisearch] Indexed product IDs differ from Medusa. Missing: ${missing.length}; unexpected: ${unexpected.length}; duplicate indexed IDs: ${indexedIds.length - indexed.size}.`
    )
  }
}

export const assertRequiredDocumentFields = (
  documents: Array<Record<string, unknown>>
): void => {
  const invalid = documents.filter((document) => {
    return REQUIRED_DOCUMENT_FIELDS.some((field) => {
      const value = document[field]
      return typeof value !== "string" || !value.trim()
    })
  })

  if (invalid.length) {
    throw new Error(
      `[meilisearch] ${invalid.length} product document(s) are missing required catalog fields.`
    )
  }
}

const searchCount = async (
  index: {
    search: (
      query: string,
      options: Record<string, unknown>
    ) => Promise<{ estimatedTotalHits?: number; totalHits?: number }>
  },
  filter: string
): Promise<number> => {
  const result = await index.search("", { limit: 0, filter })
  return result.estimatedTotalHits ?? result.totalHits ?? 0
}

type ProductDocument = Record<string, unknown> & {
  id: string
  title: string
}

type ProductIndex = {
  getDocuments: (options: {
    fields: string[]
    limit: number
    offset: number
  }) => Promise<{ results: ProductDocument[]; total?: number }>
  getStats: () => Promise<{ numberOfDocuments: number }>
  search: (
    query: string,
    options: Record<string, unknown>
  ) => Promise<{
    estimatedTotalHits?: number
    facetDistribution?: Record<string, Record<string, number>>
    hits?: ProductDocument[]
    totalHits?: number
  }>
}

const loadAllDocuments = async (
  index: ProductIndex
): Promise<ProductDocument[]> => {
  const documents: ProductDocument[] = []

  while (true) {
    const page = await index.getDocuments({
      fields: [...REQUIRED_DOCUMENT_FIELDS, "availability_states", "price_min"],
      limit: DOCUMENT_PAGE_SIZE,
      offset: documents.length,
    })
    documents.push(...page.results)
    if (
      page.results.length < DOCUMENT_PAGE_SIZE ||
      (typeof page.total === "number" && documents.length >= page.total)
    ) {
      break
    }
  }

  return documents
}

const loadPublishedProductIds = async (productModuleService: {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<[Array<{ id: string }>, number]>
}): Promise<{ ids: string[]; total: number }> => {
  const ids: string[] = []
  let total = 0

  while (true) {
    const [products, productCount] =
      await productModuleService.listAndCountProducts(
        { status: ProductStatus.PUBLISHED },
        {
          select: ["id"],
          skip: ids.length,
          take: DOCUMENT_PAGE_SIZE,
        }
      )
    total = productCount
    ids.push(...products.map(({ id }) => id))
    if (!products.length || ids.length >= total) {
      break
    }
  }

  if (ids.length !== total) {
    throw new Error(
      `[meilisearch] Published product validation loaded ${ids.length} of ${total} Medusa product IDs.`
    )
  }

  return { ids, total }
}

export const loadProductIndexIdentity = async ({
  container,
  indexKey,
}: {
  container: ExecArgs["container"]
  indexKey: string
}): Promise<{
  indexedIds: string[]
  publishedIds: string[]
}> => {
  const meilisearch = resolveMeilisearchService<{
    getIndex: (requestedIndexKey: string) => ProductIndex
  }>(container)
  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<[Array<{ id: string }>, number]>
  }
  const [{ ids: publishedIds }, documents] = await Promise.all([
    loadPublishedProductIds(productModuleService),
    loadAllDocuments(meilisearch.getIndex(indexKey)),
  ])

  return {
    indexedIds: documents.map(({ id }) => id),
    publishedIds,
  }
}

export const validateProductIndex = async ({
  container,
  indexKey,
}: {
  container: ExecArgs["container"]
  indexKey: string
}): Promise<{ indexedCount: number; publishedProductCount: number }> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const meilisearch = resolveMeilisearchService<{
    getIndex: (requestedIndexKey: string) => ProductIndex
  }>(container)

  const productModuleService = container.resolve(Modules.PRODUCT) as {
    listAndCountProducts: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<[Array<{ id: string }>, number]>
  }

  const { ids: publishedIds, total: publishedProductCount } =
    await loadPublishedProductIds(productModuleService)

  const index = meilisearch.getIndex(indexKey)
  const stats = await index.getStats()
  const indexedCount = stats.numberOfDocuments ?? 0

  logger.info(
    `[meilisearch] '${indexKey}' validation: ${publishedProductCount} published Medusa product(s), ${indexedCount} indexed document(s).`
  )

  assertPublishedProductParity({ indexedCount, publishedProductCount })
  const documents = await loadAllDocuments(index)
  assertRequiredDocumentFields(documents)
  assertExactDocumentIds({
    indexedIds: documents.map(({ id }) => id),
    publishedIds,
  })

  const [contradictoryStockCount, nonPublishedCount, unknownStockCount] =
    await Promise.all([
      searchCount(
        index,
        'status = "published" AND stock_status = "sold_out" AND availability_states = "available"'
      ),
      searchCount(index, 'status != "published"'),
      searchCount(index, 'status = "published" AND stock_status = "unknown"'),
    ])

  assertCatalogReadModelIntegrity({
    contradictoryStockCount,
    nonPublishedCount,
    unknownStockCount,
  })
  const representative = documents.find(({ title }) => title.trim())
  if (representative) {
    const representativeSearch = await index.search(representative.title, {
      limit: 20,
    })
    const representativeFound = representativeSearch.hits?.some(
      ({ id }) => id === representative.id
    )
    if (!representativeFound) {
      throw new Error(
        `[meilisearch] Representative title query did not return product '${representative.id}'.`
      )
    }
  }

  const facetAndSortProbe = await index.search("", {
    facets: ["product_type"],
    limit: 1,
    sort: ["artist_sort:asc", "title_sort:asc"],
  })
  if (!facetAndSortProbe.facetDistribution?.product_type) {
    throw new Error(
      "[meilisearch] Product-type facet probe did not return a facet distribution."
    )
  }

  logger.info(
    `[meilisearch] '${indexKey}' passed document, ID, stock, query, facet, and sort validation.`
  )
  return { indexedCount, publishedProductCount }
}

export default async function checkMeilisearchSync({
  container,
}: ExecArgs): Promise<void> {
  await validateProductIndex({
    container,
    indexKey: PRODUCTS_INDEX,
  })
}
