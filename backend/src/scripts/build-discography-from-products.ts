import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  getTotalVariantAvailability,
  Modules,
} from "@medusajs/framework/utils"

import {
  buildDiscographyProjection,
  isMusicReleaseReference,
  parseDiscographyReplacementCommandOptions,
  type DiscographyProjectionSource,
  type DiscographyProjectionVariant,
} from "@/lib/catalog/discography-projection"
import type CatalogModuleService from "@/modules/catalog/service"
import type DiscographyModuleService from "@/modules/discography/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type DiscographyService = InstanceType<typeof DiscographyModuleService>

type ProductImageRecord = {
  url?: string | null
}

type ProductVariantRecord = {
  allow_backorder?: boolean | null
  id: string
  inventory_quantity?: number | null
  manage_inventory?: boolean | null
  title?: string | null
}

type ProductRecord = {
  collection?: { title?: string | null } | null
  handle?: string | null
  id: string
  images?: ProductImageRecord[] | null
  metadata?: Record<string, unknown> | null
  status?: string | null
  thumbnail?: string | null
  title?: string | null
  variants?: ProductVariantRecord[] | null
}

type ProductService = {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: {
      relations?: string[]
      skip?: number
      take?: number
    }
  ) => Promise<[ProductRecord[], number]>
}

type CatalogProductProfileRecord = {
  id: string
  label_id?: string | null
  metadata?: Record<string, unknown> | null
  product_id: string
  product_type_id?: string | null
  release_date?: Date | string | null
  release_title?: string | null
  release_year?: number | null
  search_keywords?: string[] | null
}

type CatalogReferenceValueRecord = {
  id: string
  is_active?: boolean | null
  kind: string
  label: string
  value: string
}

type CatalogProductArtistRecord = {
  display_name: string
  product_profile_id: string
  sort_order?: number | null
}

type CatalogProductReferenceRecord = {
  kind: string
  product_profile_id: string
  reference_value_id: string
  sort_order?: number | null
}

type CatalogVariantProfileRecord = {
  availability_status?: string | null
  variant_id: string
}

type ExistingDiscographyRecord = {
  archived_at?: Date | string | null
  id: string
  product_id?: string | null
  source_mode?: string | null
}

const listAll = async <T>(
  fetchPage: (skip: number, take: number) => Promise<[T[], number]>
): Promise<T[]> => {
  const results: T[] = []
  const take = 200
  let skip = 0
  while (true) {
    const [items, count] = await fetchPage(skip, take)
    results.push(...items)
    skip += items.length
    if (!items.length || skip >= count) {
      return results
    }
  }
}

const groupBy = <T>(
  entries: T[],
  keyFor: (entry: T) => string
): Map<string, T[]> => {
  const result = new Map<string, T[]>()
  entries.forEach((entry) => {
    const key = keyFor(entry)
    result.set(key, [...(result.get(key) ?? []), entry])
  })
  return result
}

const defaultStateDirectory = (): string =>
  path.join(
    os.homedir(),
    ".local",
    "share",
    "remorseless-records",
    "discography-rebuild"
  )

const writeJsonAtomically = async (
  destination: string,
  value: unknown
): Promise<void> => {
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
  await fs.rename(temporary, destination)
}

const toProjectionVariant = (
  variant: ProductVariantRecord,
  availabilityStatus: string | null,
  inventoryQuantity: number | null
): DiscographyProjectionVariant => ({
  allowBackorder: variant.allow_backorder ?? null,
  availabilityStatus,
  inventoryQuantity,
  manageInventory: variant.manage_inventory ?? null,
  title: variant.title ?? null,
})

export default async function buildDiscographyFromProducts({
  args = [],
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = parseDiscographyReplacementCommandOptions([
    ...args,
    ...process.argv.slice(2),
  ])
  const productService = container.resolve(Modules.PRODUCT) as ProductService
  const catalogService = container.resolve("catalog") as CatalogService
  const discographyService = container.resolve(
    "discography"
  ) as DiscographyService

  const [
    products,
    profiles,
    referenceValues,
    productArtists,
    productReferences,
    variantProfiles,
    existingEntries,
  ] = await Promise.all([
    listAll<ProductRecord>((skip, take) =>
      productService.listAndCountProducts(
        {},
        {
          relations: ["collection", "images", "variants"],
          skip,
          take,
        }
      )
    ),
    listAll<CatalogProductProfileRecord>((skip, take) =>
      catalogService.listAndCountCatalogProductProfiles({}, { skip, take })
    ),
    listAll<CatalogReferenceValueRecord>((skip, take) =>
      catalogService.listAndCountCatalogReferenceValues({}, { skip, take })
    ),
    listAll<CatalogProductArtistRecord>((skip, take) =>
      catalogService.listAndCountCatalogProductArtists({}, { skip, take })
    ),
    listAll<CatalogProductReferenceRecord>((skip, take) =>
      catalogService.listAndCountCatalogProductReferences({}, { skip, take })
    ),
    listAll<CatalogVariantProfileRecord>((skip, take) =>
      catalogService.listAndCountCatalogVariantProfiles({}, { skip, take })
    ),
    listAll<ExistingDiscographyRecord>((skip, take) =>
      discographyService.listAndCountDiscographyEntries({}, { skip, take })
    ),
  ])

  const productsById = new Map(products.map((product) => [product.id, product]))
  const referenceValuesById = new Map(
    referenceValues.map((reference) => [reference.id, reference])
  )
  const artistsByProfile = groupBy(
    productArtists,
    ({ product_profile_id }) => product_profile_id
  )
  const referencesByProfile = groupBy(
    productReferences,
    ({ product_profile_id }) => product_profile_id
  )
  const variantAvailabilityById = new Map(
    variantProfiles.map((profile) => [
      profile.variant_id,
      profile.availability_status ?? null,
    ])
  )
  const musicProfiles = profiles.filter((profile) => {
    const productType = profile.product_type_id
      ? referenceValuesById.get(profile.product_type_id)
      : null
    return Boolean(
      productType?.is_active !== false &&
      productType?.kind === "product_type" &&
      isMusicReleaseReference(productType.value)
    )
  })
  const missingProductIds = musicProfiles
    .filter((profile) => !productsById.has(profile.product_id))
    .map(({ product_id }) => product_id)
  if (missingProductIds.length) {
    throw new Error(
      `${missingProductIds.length} music-release profile(s) reference missing products: ${missingProductIds.slice(0, 10).join(", ")}`
    )
  }

  const publishedProfiles = musicProfiles.filter(
    (profile) =>
      productsById.get(profile.product_id)?.status?.toLowerCase() ===
      "published"
  )
  const publishedProducts = publishedProfiles.flatMap((profile) => {
    const product = productsById.get(profile.product_id)
    return product ? [product] : []
  })
  const variantIds = publishedProducts.flatMap((product) =>
    (product.variants ?? []).map(({ id }) => id)
  )
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as Parameters<typeof getTotalVariantAvailability>[0]
  const inventoryByVariantId = variantIds.length
    ? await getTotalVariantAvailability(query, {
        variant_ids: variantIds,
      })
    : {}
  const managedVariantsWithoutInventory = publishedProducts.flatMap((product) =>
    (product.variants ?? []).flatMap((variant) => {
      if (variant.manage_inventory === false) {
        return []
      }
      return typeof inventoryByVariantId[variant.id]?.availability === "number"
        ? []
        : [variant.id]
    })
  )
  if (managedVariantsWithoutInventory.length) {
    throw new Error(
      `${managedVariantsWithoutInventory.length} managed music-release variant(s) are missing inventory availability: ${managedVariantsWithoutInventory.slice(0, 10).join(", ")}`
    )
  }
  const sources: DiscographyProjectionSource[] = publishedProfiles.map(
    (profile) => {
      const product = productsById.get(profile.product_id)
      if (!product?.handle || !product.title) {
        throw new Error(
          `${profile.product_id} is missing a product handle or title.`
        )
      }
      const productType = profile.product_type_id
        ? referenceValuesById.get(profile.product_type_id)
        : null
      if (!productType) {
        throw new Error(
          `${profile.product_id} has no controlled product type reference.`
        )
      }
      const label = profile.label_id
        ? (referenceValuesById.get(profile.label_id)?.label ?? null)
        : null

      return {
        artists: (artistsByProfile.get(profile.id) ?? []).map((artist) => ({
          displayName: artist.display_name,
          sortOrder: artist.sort_order ?? 0,
        })),
        collectionTitle: product.collection?.title ?? null,
        coverUrl:
          product.thumbnail ??
          product.images?.find(({ url }) => Boolean(url))?.url ??
          null,
        label,
        product: {
          handle: product.handle,
          id: product.id,
          metadata: product.metadata ?? {},
          status: product.status ?? null,
          title: product.title,
          variants: (product.variants ?? []).map((variant) =>
            toProjectionVariant(
              variant,
              variantAvailabilityById.get(variant.id) ?? null,
              variant.manage_inventory === false
                ? null
                : (inventoryByVariantId[variant.id]?.availability ?? null)
            )
          ),
        },
        profile: {
          metadata: profile.metadata ?? {},
          productTypeValue: productType.value,
          releaseDate: profile.release_date ?? null,
          releaseTitle: profile.release_title ?? null,
          releaseYear: profile.release_year ?? null,
          searchKeywords: profile.search_keywords ?? [],
        },
        references: (referencesByProfile.get(profile.id) ?? []).flatMap(
          (link) => {
            const reference = referenceValuesById.get(link.reference_value_id)
            if (!reference || reference.is_active === false) {
              return []
            }
            return [
              {
                kind: link.kind,
                label: reference.label,
                sortOrder: link.sort_order ?? 0,
                value: reference.value,
              },
            ]
          }
        ),
      }
    }
  )
  const projection = buildDiscographyProjection(sources)
  const projectedProductIds = projection.map(({ product_id }) => product_id)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const stateDirectory = path.resolve(
    options.stateDirectory ?? defaultStateDirectory()
  )
  await fs.mkdir(stateDirectory, { mode: 0o700, recursive: true })
  const planPath = path.join(stateDirectory, `plan-${timestamp}.json`)
  await writeJsonAtomically(planPath, {
    existingEntries,
    generatedAt: new Date().toISOString(),
    projectedEntries: projection,
    summary: {
      existingActiveEntries: existingEntries.length,
      nonMusicProfiles: profiles.length - musicProfiles.length,
      projectedEntries: projection.length,
      unpublishedMusicProfiles: musicProfiles.length - publishedProfiles.length,
    },
  })

  logger.info(
    `[discography] mode=${options.apply ? "apply" : "dry-run"} current=${existingEntries.length} projected=${projection.length} unpublished=${musicProfiles.length - publishedProfiles.length} plan=${planPath}`
  )
  if (!options.apply) {
    logger.info(
      "[discography] Dry run complete. No discography records were changed."
    )
    return
  }

  const result =
    await discographyService.replaceWithCatalogProjection(projection)
  const rebuiltEntries = await listAll<ExistingDiscographyRecord>(
    (skip, take) =>
      discographyService.listAndCountDiscographyEntries({}, { skip, take })
  )
  const rebuiltProductIds = rebuiltEntries
    .filter(
      ({ product_id, source_mode }) =>
        Boolean(product_id) &&
        source_mode === "catalog_product" &&
        projectedProductIds.includes(product_id ?? "")
    )
    .map(({ product_id }) => product_id)
    .filter((id): id is string => Boolean(id))
    .sort()
  const activeStaleLinkedEntries = rebuiltEntries.filter(
    ({ archived_at, product_id, source_mode }) =>
      source_mode === "catalog_product" &&
      Boolean(product_id) &&
      !projectedProductIds.includes(product_id ?? "") &&
      !archived_at
  )
  if (
    rebuiltProductIds.length !== projection.length ||
    activeStaleLinkedEntries.length > 0 ||
    JSON.stringify(rebuiltProductIds) !==
      JSON.stringify([...projectedProductIds].sort())
  ) {
    throw new Error(
      "Discography parity validation failed after replacement; use the pre-rebuild plan for recovery."
    )
  }

  const completionPath = path.join(
    stateDirectory,
    `completed-${timestamp}.json`
  )
  await writeJsonAtomically(completionPath, {
    archived: result.archived,
    completedAt: new Date().toISOString(),
    created: result.created,
    productIds: rebuiltProductIds,
    retainedManual: result.retainedManual,
    updated: result.updated,
  })
  logger.info(
    `[discography] Sync complete. created=${result.created} updated=${result.updated} archived=${result.archived} retained_manual=${result.retainedManual} report=${completionPath}`
  )
}
