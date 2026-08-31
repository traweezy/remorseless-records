import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import { callCatalogServiceMethod } from "@/lib/catalog/catalog-service-method"
import { homepageShelfCopy } from "@/lib/catalog/homepage-shelf-copy"
import {
  readAdminCatalogShelfList,
  readAdminCatalogShelfMutation,
  readAdminCatalogShelfProducts,
  readExactAdminCatalogShelfProducts,
} from "@/lib/catalog/shelf-persistence-contracts"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type ProductCollection = { id: string; handle?: string | null }
type ProductSummary = { id: string; handle?: string | null }
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
    ...homepageShelfCopy["new-releases"],
    mode: "automatic" as const,
    automation_type: "new_release" as const,
    show_ribbon: true,
    ribbon_label: "New",
    ribbon_priority: 10,
    product_limit: 12,
    is_active: true,
    metadata: { lookbackDays: 180 },
    legacyCollectionHandle: null,
    initialProductHandles: [],
  },
  {
    handle: "featured",
    ...homepageShelfCopy.featured,
    mode: "manual" as const,
    automation_type: "none" as const,
    show_ribbon: true,
    ribbon_label: "Featured",
    ribbon_priority: 20,
    product_limit: 12,
    is_active: true,
    metadata: {},
    legacyCollectionHandle: "featured",
    initialProductHandles: [
      "music-release-morbosidad-tortura",
      "music-release-sijjin-helljjin-combat",
      "music-release-purulent-remains-worm-eaten-corpse",
      "music-release-elitist-a-mirage-of-grandeur",
      "music-release-pustilence-beliefs-of-dead-stargazers-and-soothsayers",
      "music-release-madatys-kuoleman-ulottuvuudet",
      "music-release-sulfuric-cautery-tolerance-split",
    ],
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
    initialProductHandles: [
      "music-release-mausoleum-defiling-the-decayed",
      "music-release-wormed-omegon",
      "music-release-phobophilic-undimensioned-identities",
      "music-release-cryptic-shift-return-to-realms",
      "music-release-ilsa-repression",
      "music-release-sn-mokvani-v-okovech",
    ],
  },
] as const

const initialSeedVersion = 1

const loadInitialProducts = async (
  productService: ProductService,
  seed: (typeof shelfSeeds)[number]
): Promise<ProductSummary[]> => {
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
        return products
      }
    }
  }

  const products = await Promise.all(
    seed.initialProductHandles.map(async (handle) => {
      const matches = await productService.listProducts(
        { handle, status: ProductStatus.PUBLISHED },
        { take: 1 }
      )
      return matches[0]
    })
  )
  const missingHandles = seed.initialProductHandles.filter(
    (_handle, index) => !products[index]
  )
  if (missingHandles.length) {
    throw new Error(
      `Missing initial shelf products: ${missingHandles.join(", ")}`
    )
  }

  return products.filter((product): product is ProductSummary =>
    Boolean(product)
  )
}

export default async function seedCatalogShelves({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const catalogService = container.resolve<CatalogService>("catalog")
  const productService = container.resolve<ProductService>(Modules.PRODUCT)

  for (const seed of shelfSeeds) {
    const existing = readAdminCatalogShelfList(
      await callCatalogServiceMethod(
        catalogService,
        ["listCatalogShelves", "listCatalogShelfs"],
        [{ handle: seed.handle }]
      ),
      { expectedHandle: seed.handle, maximumRows: 1 }
    )
    let shelf = existing[0]
    let createdNow = false
    if (!shelf) {
      shelf = readAdminCatalogShelfMutation(
        await callCatalogServiceMethod(
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
        ),
        {
          fields: { handle: seed.handle },
          version: 1,
        }
      )
      createdNow = true
    }
    if (!shelf) {
      throw new Error(`Unable to create '${seed.handle}' catalog shelf`)
    }

    const metadata = shelf.metadata ?? {}
    if (metadata.initialSeedVersion === initialSeedVersion) {
      logger.info(`[catalog-shelves] Kept existing '${seed.handle}' shelf.`)
      continue
    }

    const existingMemberships = readAdminCatalogShelfProducts(
      await catalogService.listCatalogShelfProducts(
        { shelf_id: shelf.id },
        { take: 1 }
      ),
      [shelf.id],
      1
    )
    let importedCount = 0
    if (!existingMemberships.length) {
      const products = await loadInitialProducts(productService, seed)
      if (products.length) {
        const expectedMemberships = products.map((product, index) => ({
          ends_at: null,
          is_pinned: false,
          metadata: {
            initialSeedVersion,
            legacyCollectionHandle: seed.legacyCollectionHandle,
          },
          product_id: product.id,
          product_profile_id: null,
          sort_order: index,
          starts_at: null,
        }))
        readExactAdminCatalogShelfProducts(
          await catalogService.createCatalogShelfProducts(
            products.map((product, index) => ({
              shelf_id: shelf.id,
              product_id: product.id,
              sort_order: index,
              is_pinned: false,
              metadata: {
                initialSeedVersion,
                legacyCollectionHandle: seed.legacyCollectionHandle,
              },
            }))
          ),
          shelf.id,
          expectedMemberships
        )
        importedCount = products.length
      }
    }

    const updatedMetadata = {
      ...seed.metadata,
      ...metadata,
      initialSeedVersion,
    }
    readAdminCatalogShelfMutation(
      await callCatalogServiceMethod(
        catalogService,
        ["updateCatalogShelves", "updateCatalogShelfs"],
        [[{ id: shelf.id, metadata: updatedMetadata }]]
      ),
      {
        fields: { metadata: updatedMetadata },
        id: shelf.id,
        version: shelf.version + 1,
      }
    )

    logger.info(
      `[catalog-shelves] ${createdNow ? "Created" : "Initialized"} '${seed.handle}' with ${importedCount} seeded product(s).`
    )
  }
}
