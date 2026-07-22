import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type CatalogServiceMethod = (...args: unknown[]) => Promise<unknown>
type CatalogServiceMethods = Record<string, CatalogServiceMethod | undefined>
type ProductCollection = { id: string; handle?: string | null }
type ProductSummary = { id: string }
type ProductService = {
  listProductCollections: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<ProductCollection[]>
  listProducts: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<ProductSummary[]>
}

const shelfSeeds = [
  {
    handle: "new-releases",
    title: "Newest Arrivals",
    description:
      "Fresh represses and new signings—these move fast. Bookmark them or lose them forever.",
    mode: "automatic" as const,
    automation_type: "new_release" as const,
    show_ribbon: true,
    ribbon_label: "New Release",
    ribbon_priority: 10,
    product_limit: 12,
    is_active: true,
    metadata: { lookbackDays: 180 },
    legacyCollectionHandle: null,
  },
  {
    handle: "featured",
    title: "Featured Picks",
    description:
      "Curated slabs hand-picked from the vault—limited, savage, and in stock right now.",
    mode: "manual" as const,
    automation_type: "none" as const,
    show_ribbon: true,
    ribbon_label: "Featured",
    ribbon_priority: 20,
    product_limit: 12,
    is_active: true,
    metadata: {},
    legacyCollectionHandle: "featured",
  },
  {
    handle: "staff-picks",
    title: "Staff Signals",
    description:
      "Releases we can't stop looping. Tuned for the true devotees only.",
    mode: "manual" as const,
    automation_type: "none" as const,
    show_ribbon: true,
    ribbon_label: "Staff Pick",
    ribbon_priority: 30,
    product_limit: 12,
    is_active: true,
    metadata: {},
    legacyCollectionHandle: "staff-picks",
  },
] as const

const first = <T>(value: T | T[]): T | undefined =>
  Array.isArray(value) ? value[0] : value

const callCatalogService = async <T>(
  catalogService: CatalogService,
  candidates: readonly string[],
  args: unknown[]
): Promise<T> => {
  const methods = catalogService as unknown as CatalogServiceMethods
  const methodName = candidates.find(
    (candidate) => typeof methods[candidate] === "function"
  )
  const method = methodName ? methods[methodName] : undefined
  if (!method) {
    throw new Error(`Catalog service is missing ${candidates.join(" or ")}`)
  }
  return (await method.apply(catalogService, args)) as T
}

export default async function seedCatalogShelves({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const catalogService = container.resolve("catalog") as CatalogService
  const productService = container.resolve(Modules.PRODUCT) as ProductService

  for (const seed of shelfSeeds) {
    const existing = await callCatalogService<Array<{ id: string }>>(
      catalogService,
      ["listCatalogShelves", "listCatalogShelfs"],
      [{ handle: seed.handle }]
    )
    if (existing.length) {
      logger.info(`[catalog-shelves] Kept existing '${seed.handle}' shelf.`)
      continue
    }

    const created = first(
      await callCatalogService<Array<{ id: string }> | { id: string }>(
        catalogService,
        ["createCatalogShelves", "createCatalogShelfs"],
        [
          [
            {
              handle: seed.handle,
              title: seed.title,
              description: seed.description,
              mode: seed.mode,
              automation_type: seed.automation_type,
              show_ribbon: seed.show_ribbon,
              ribbon_label: seed.ribbon_label,
              ribbon_priority: seed.ribbon_priority,
              product_limit: seed.product_limit,
              is_active: seed.is_active,
              metadata: seed.metadata,
            },
          ],
        ]
      )
    )
    if (!created) {
      throw new Error(`Unable to create '${seed.handle}' catalog shelf`)
    }

    let importedCount = 0
    if (seed.legacyCollectionHandle) {
      const collections = await productService.listProductCollections(
        { handle: seed.legacyCollectionHandle },
        { take: 1 }
      )
      const collection = collections[0]
      if (collection) {
        const products = await productService.listProducts(
          {
            collection_id: collection.id,
            status: ProductStatus.PUBLISHED,
          },
          { take: 200, order: { created_at: "DESC" } }
        )
        if (products.length) {
          await catalogService.createCatalogShelfProducts(
            products.map((product, index) => ({
              shelf_id: created.id,
              product_id: product.id,
              sort_order: index,
              is_pinned: false,
              metadata: { migratedFromCollection: seed.legacyCollectionHandle },
            }))
          )
          importedCount = products.length
        }
      }
    }

    logger.info(
      `[catalog-shelves] Created '${seed.handle}' with ${importedCount} migrated product(s).`
    )
  }
}
