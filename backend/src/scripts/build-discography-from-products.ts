import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  getTotalVariantAvailability,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "zod"

import {
  buildDiscographyProjection,
  isMusicReleaseReference,
  parseDiscographyReplacementCommandOptions,
  type DiscographyProjectionSource,
  type DiscographyProjectionVariant,
} from "@/lib/catalog/discography-projection"
import { loadAllDiscographyProjectionRecords } from "@/lib/content/persistence-contracts"
import type CatalogModuleService from "@/modules/catalog/service"
import type DiscographyModuleService from "@/modules/discography/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type DiscographyService = InstanceType<typeof DiscographyModuleService>

const identifierSchema = z.string().trim().min(1).max(255)
const nullableShortTextSchema = z.string().max(5_000).nullable().optional()
const jsonRecordSchema = z
  .record(z.string().min(1).max(255), z.unknown())
  .refine((record) => Object.keys(record).length <= 200)

const productImageRecordSchema = z.object({
  url: z.string().max(2_048).nullable().optional(),
})

const productVariantRecordSchema = z.object({
  allow_backorder: z.boolean().nullable().optional(),
  id: identifierSchema,
  inventory_quantity: z.number().finite().nullable().optional(),
  manage_inventory: z.boolean().nullable().optional(),
  title: nullableShortTextSchema,
})

const productRecordSchema = z.object({
  collection: z
    .object({ title: nullableShortTextSchema })
    .nullable()
    .optional(),
  handle: z.string().max(255).nullable().optional(),
  id: identifierSchema,
  images: z.array(productImageRecordSchema).max(250).nullable().optional(),
  metadata: jsonRecordSchema.nullable().optional(),
  status: z.string().max(64).nullable().optional(),
  thumbnail: z.string().max(2_048).nullable().optional(),
  title: nullableShortTextSchema,
  variants: z
    .array(productVariantRecordSchema)
    .max(250)
    .refine(
      (variants) =>
        new Set(variants.map(({ id }) => id)).size === variants.length
    )
    .nullable()
    .optional(),
})

type ProductRecord = z.infer<typeof productRecordSchema>
type ProductVariantRecord = z.infer<typeof productVariantRecordSchema>

type ProductService = {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: {
      order?: Record<string, "ASC" | "DESC">
      relations?: string[]
      skip?: number
      take?: number
    }
  ) => Promise<[ProductRecord[], number]>
}

const catalogProductProfileRecordSchema = z.object({
  id: identifierSchema,
  label_id: identifierSchema.nullable().optional(),
  metadata: jsonRecordSchema.nullable().optional(),
  product_id: identifierSchema,
  product_type_id: identifierSchema.nullable().optional(),
  release_date: z.union([z.date(), z.iso.datetime()]).nullable().optional(),
  release_title: nullableShortTextSchema,
  release_year: z.number().int().min(1_000).max(9_999).nullable().optional(),
  search_keywords: z.array(z.string().max(255)).max(500).nullable().optional(),
})

const catalogReferenceValueRecordSchema = z.object({
  id: identifierSchema,
  is_active: z.boolean().nullable().optional(),
  kind: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(5_000),
  value: z.string().trim().min(1).max(255),
})

const catalogProductArtistRecordSchema = z.object({
  display_name: z.string().trim().min(1).max(5_000),
  id: identifierSchema,
  product_profile_id: identifierSchema,
  sort_order: z.number().int().nonnegative().nullable().optional(),
})

const catalogProductReferenceRecordSchema = z.object({
  id: identifierSchema,
  kind: z.string().trim().min(1).max(64),
  product_profile_id: identifierSchema,
  reference_value_id: identifierSchema,
  sort_order: z.number().int().nonnegative().nullable().optional(),
})

const catalogVariantProfileRecordSchema = z.object({
  availability_status: z.string().max(64).nullable().optional(),
  id: identifierSchema,
  variant_id: identifierSchema,
})

type CatalogProductProfileRecord = z.infer<
  typeof catalogProductProfileRecordSchema
>
type CatalogReferenceValueRecord = z.infer<
  typeof catalogReferenceValueRecordSchema
>
type CatalogProductArtistRecord = z.infer<
  typeof catalogProductArtistRecordSchema
>
type CatalogProductReferenceRecord = z.infer<
  typeof catalogProductReferenceRecordSchema
>
type CatalogVariantProfileRecord = z.infer<
  typeof catalogVariantProfileRecordSchema
>

const MAXIMUM_SOURCE_RECORDS = 100_000

export const listAll = async <T>(
  fetchPage: (skip: number, take: number) => Promise<unknown>,
  decodeRecord: (record: unknown) => T,
  identity?: (record: T) => string
): Promise<T[]> => {
  const results: T[] = []
  const identities = new Set<string>()
  const take = 200
  let expectedCount: number | null = null
  while (expectedCount === null || results.length < expectedCount) {
    const value = await fetchPage(results.length, take)
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Array.isArray(value[0]) ||
      !Number.isSafeInteger(value[1]) ||
      value[1] < 0 ||
      value[1] > MAXIMUM_SOURCE_RECORDS
    ) {
      throw new Error(
        "Discography source pagination returned invalid structured data."
      )
    }
    let items: T[]
    try {
      items = value[0].map(decodeRecord)
    } catch {
      throw new Error(
        "Discography source pagination returned invalid record data."
      )
    }
    const count = value[1] as number
    const stableCount: number = expectedCount ?? count
    expectedCount = stableCount
    const expectedPageLength = Math.min(take, stableCount - results.length)
    if (
      count !== stableCount ||
      expectedPageLength < 0 ||
      items.length !== expectedPageLength
    ) {
      throw new Error(
        "Discography source pagination changed during the rebuild."
      )
    }
    if (identity) {
      for (const item of items) {
        const key = identity(item)
        if (!key || identities.has(key)) {
          throw new Error(
            "Discography source pagination returned duplicate identities."
          )
        }
        identities.add(key)
      }
    }
    results.push(...items)
  }
  return results
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
  const productService = container.resolve<ProductService>(Modules.PRODUCT)
  const catalogService = container.resolve<CatalogService>("catalog")
  const discographyService =
    container.resolve<DiscographyService>("discography")

  const [
    products,
    profiles,
    referenceValues,
    productArtists,
    productReferences,
    variantProfiles,
    existingEntries,
  ] = await Promise.all([
    listAll<ProductRecord>(
      (skip, take) =>
        productService.listAndCountProducts(
          {},
          {
            order: { id: "ASC" },
            relations: ["collection", "images", "variants"],
            skip,
            take,
          }
        ),
      (record) => productRecordSchema.parse(record),
      ({ id }) => id
    ),
    listAll<CatalogProductProfileRecord>(
      (skip, take) =>
        catalogService.listAndCountCatalogProductProfiles(
          {},
          { order: { id: "ASC" }, skip, take }
        ),
      (record) => catalogProductProfileRecordSchema.parse(record),
      ({ id }) => id
    ),
    listAll<CatalogReferenceValueRecord>(
      (skip, take) =>
        catalogService.listAndCountCatalogReferenceValues(
          {},
          { order: { id: "ASC" }, skip, take }
        ),
      (record) => catalogReferenceValueRecordSchema.parse(record),
      ({ id }) => id
    ),
    listAll<CatalogProductArtistRecord>(
      (skip, take) =>
        catalogService.listAndCountCatalogProductArtists(
          {},
          { order: { id: "ASC" }, skip, take }
        ),
      (record) => catalogProductArtistRecordSchema.parse(record),
      ({ id }) => id
    ),
    listAll<CatalogProductReferenceRecord>(
      (skip, take) =>
        catalogService.listAndCountCatalogProductReferences(
          {},
          { order: { id: "ASC" }, skip, take }
        ),
      (record) => catalogProductReferenceRecordSchema.parse(record),
      ({ id }) => id
    ),
    listAll<CatalogVariantProfileRecord>(
      (skip, take) =>
        catalogService.listAndCountCatalogVariantProfiles(
          {},
          { order: { id: "ASC" }, skip, take }
        ),
      (record) => catalogVariantProfileRecordSchema.parse(record),
      ({ id }) => id
    ),
    loadAllDiscographyProjectionRecords((skip, take) =>
      discographyService.listAndCountDiscographyEntries(
        {},
        { order: { id: "ASC" }, skip, take }
      )
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
  const query = container.resolve<
    Parameters<typeof getTotalVariantAvailability>[0]
  >(ContainerRegistrationKeys.QUERY)
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
  const rebuiltEntries = await loadAllDiscographyProjectionRecords(
    (skip, take) =>
      discographyService.listAndCountDiscographyEntries(
        {},
        { order: { id: "ASC" }, skip, take }
      )
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
