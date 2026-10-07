import type {
  Context,
  IProductModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "../../modules/catalog/catalog-command"
import {
  readCatalogProductProfiles,
  readCatalogVariantProfiles,
} from "./profile-persistence-contracts"
import type { CatalogService } from "./reference-resolution"
import {
  readCatalogMediaAssets,
  readCatalogProductMediaItems,
  readCatalogTransactionOperationList,
} from "./transaction-persistence-contracts"

const identifier = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[A-Za-z0-9_-]{1,248}$`, "u"))
const repairIdentity = z
  .object({
    creationOperationId: identifier("catop_"),
    productId: identifier("prod_"),
  })
  .strict()
const repairCommand = repairIdentity
  .extend({
    expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    idempotencyKey: z.uuid(),
  })
  .strict()
export type FailedCreationRepairIdentity = z.infer<typeof repairIdentity>
export type FailedCreationRepairCommand = z.infer<typeof repairCommand>
const commandName = "catalog.failed-creation.repair"

const ensure = (condition: unknown): void => {
  if (!condition)
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Failed-creation repair evidence changed or does not prove exclusive ownership."
    )
}
// Convert native Dates before canonical hashing, and keep field contents out of
// the operator manifest. The digest still binds every persisted row field.
const rowDigest = (row: unknown): string =>
  hashCatalogCommand(JSON.parse(JSON.stringify(row)))
const ordered = <T extends { id: string }>(rows: T[]): T[] =>
  [...rows].sort((left, right) => left.id.localeCompare(right.id))

const inspect = async (
  container: MedusaContainer,
  input: FailedCreationRepairIdentity,
  context: Context<EntityManager>
) => {
  const catalog = container.resolve<CatalogService>("catalog")
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  ensure(
    (
      await products.listProducts(
        { id: input.productId },
        { take: 2, withDeleted: true }
      )
    ).length === 0
  )
  const parentRows = await catalog.listCatalogAuthoringOperations(
    { id: input.creationOperationId },
    { take: 2 },
    context
  )
  const parent = readCatalogTransactionOperationList(parentRows)
  ensure(
    parent?.id === input.creationOperationId &&
      parent.command === "catalog.product.create" &&
      parent.status === "compensated" &&
      parent.expectedVersion === 0 &&
      parent.aggregateId ===
        `catalog-product-create:${parent.idempotencyKey}` &&
      Object.keys(parent.result).length === 0
  )
  if (!parent)
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Creation operation is unavailable."
    )
  const profileRows = await catalog.listCatalogProductProfiles(
    { product_id: input.productId },
    { take: 2 },
    context
  )
  const profiles = readCatalogProductProfiles(profileRows, input.productId)
  ensure(profiles.length === 1 && profiles[0]?.version === 1)
  const profile = profiles[0]!
  const variantRows = ordered(
    await catalog.listCatalogVariantProfiles(
      { product_profile_id: profile.id },
      { take: 101 },
      context
    )
  )
  ensure(variantRows.length > 0 && variantRows.length <= 100)
  const variants = variantRows.map(
    (row) => readCatalogVariantProfiles([row], row.variant_id)[0]!
  )
  ensure(
    new Set(variants.map((row) => row.variant_id)).size === variants.length &&
      variants.every(
        (row) => row.version === 1 && row.product_profile_id === profile.id
      )
  )
  const variantIds = variants.map((row) => row.variant_id)
  ensure(
    (
      await products.listProductVariants(
        { id: variantIds },
        { take: 101, withDeleted: true }
      )
    ).length === 0
  )
  const mediaRows = ordered(
    await catalog.listCatalogProductMediaItems(
      { product_id: input.productId },
      { take: 101 },
      context
    )
  )
  const media = readCatalogProductMediaItems(
    mediaRows,
    { productId: input.productId },
    100
  )
  ensure(
    media.length > 0 &&
      media.every(
        (row) =>
          row.product_profile_id === profile.id && row.variant_id === null
      )
  )
  const assetIds = [...new Set(media.map((row) => row.media_asset_id))].sort()
  const assetRows = ordered(
    await catalog.listCatalogMediaAssets(
      { id: assetIds },
      { take: 101 },
      context
    )
  )
  const assets = readCatalogMediaAssets(assetRows, { maximumRows: 100 })
  ensure(
    assets.length === assetIds.length &&
      hashCatalogCommand(assets.map((row) => row.id).sort()) ===
        hashCatalogCommand(assetIds) &&
      assets.every((row) => row.lifecycle_status === "active")
  )
  const forbidden = await Promise.all([
    catalog.listCatalogBundleProfiles(
      { product_id: input.productId },
      { take: 1 },
      context
    ),
    catalog.listCatalogProductArtists(
      { product_profile_id: profile.id },
      { take: 1 },
      context
    ),
    catalog.listCatalogProductReferences(
      { product_profile_id: profile.id },
      { take: 1 },
      context
    ),
    catalog.listCatalogShelfProducts(
      { product_id: input.productId },
      { take: 1 },
      context
    ),
  ])
  ensure(forbidden.every((rows) => rows.length === 0))
  const childRows = ordered(
    await catalog.listCatalogAuthoringOperations(
      { aggregate_id: [input.productId, ...variantIds] },
      { take: 103 },
      context
    )
  )
  ensure(childRows.length === variants.length + 2)
  const children = childRows.map(
    (row) => readCatalogTransactionOperationList([row])!
  )
  ensure(
    children.every(
      (row) =>
        row.status === "succeeded" &&
        row.expectedVersion === 0 &&
        row.actorId === parent.actorId
    )
  )
  const profileOperation = children.find(
    (row) => row.command === "catalog.product-profile.upsert"
  )
  const mediaOperation = children.find(
    (row) => row.command === "catalog.product-media.replace"
  )
  ensure(
    profileOperation?.idempotencyKey ===
      deriveCatalogCommandIdempotencyKey(
        parent.idempotencyKey,
        "product-profile"
      ) &&
      profileOperation.aggregateId === input.productId &&
      profileOperation.result.profileId === profile.id &&
      profileOperation.result.productId === input.productId &&
      profileOperation.result.version === 1 &&
      profileOperation.result.created === true
  )
  ensure(
    mediaOperation?.idempotencyKey ===
      deriveCatalogCommandIdempotencyKey(
        parent.idempotencyKey,
        "product-media"
      ) &&
      mediaOperation.aggregateId === input.productId &&
      mediaOperation.result.productId === input.productId &&
      mediaOperation.result.version === 1
  )
  for (const variant of variants) {
    const matches = children.filter(
      (row) =>
        row.aggregateId === variant.variant_id &&
        row.command === "catalog.variant-profile.upsert"
    )
    ensure(
      matches.length === 1 &&
        matches[0]?.result.profileId === variant.id &&
        matches[0].result.variantId === variant.variant_id &&
        matches[0].result.created === true &&
        matches[0].result.version === 1
    )
  }
  const manifest = {
    schemaVersion: 1,
    creationOperationId: input.creationOperationId,
    productId: input.productId,
    nativeProductAbsent: true,
    nativeVariantsAbsent: variantIds,
    creation: {
      id: parent.id,
      status: parent.status,
      rowSha256: rowDigest(parentRows[0]),
    },
    profile: {
      id: profile.id,
      version: profile.version,
      rowSha256: rowDigest(profileRows[0]),
    },
    variants: variantRows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      version: row.version,
      rowSha256: rowDigest(row),
    })),
    media: mediaRows.map((row) => ({
      id: row.id,
      assetId: row.media_asset_id,
      rowSha256: rowDigest(row),
    })),
    assets: assetRows.map((row) => ({
      id: row.id,
      version: row.version,
      rowSha256: rowDigest(row),
    })),
    children: childRows.map((row) => ({
      id: row.id,
      command: row.command,
      status: row.status,
      rowSha256: rowDigest(row),
    })),
  }
  return { manifest, manifestSha256: hashCatalogCommand(manifest) }
}

export const inspectFailedCatalogCreation = async (
  container: MedusaContainer,
  rawInput: FailedCreationRepairIdentity
) => {
  const input = repairIdentity.parse(rawInput)
  return container
    .resolve<CatalogService>("catalog")
    .runCatalogTransaction((context) => inspect(container, input, context))
}

export const repairFailedCatalogCreation = async (
  container: MedusaContainer,
  rawInput: FailedCreationRepairCommand
) => {
  const input = repairCommand.parse(rawInput)
  const catalog = container.resolve<CatalogService>("catalog")
  const requestSha256 = hashCatalogCommand(input)
  return catalog.runCatalogTransaction(async (context) => {
    const existing = readCatalogTransactionOperationList(
      await catalog.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        context
      )
    )
    if (existing) {
      ensure(
        existing.command === commandName &&
          existing.aggregateId === input.productId &&
          existing.requestSha256 === requestSha256 &&
          existing.status === "succeeded" &&
          existing.result.manifestSha256 === input.expectedManifestSha256 &&
          existing.result.creationOperationId === input.creationOperationId &&
          existing.result.productId === input.productId
      )
      return {
        operationId: existing.id,
        replayed: true,
        result: existing.result,
      }
    }
    const { manifest, manifestSha256 } = await inspect(
      container,
      input,
      context
    )
    ensure(manifestSha256 === input.expectedManifestSha256)
    const operation = readCatalogTransactionOperationList(
      await catalog.createCatalogAuthoringOperations(
        [
          {
            actor_id: null,
            aggregate_id: input.productId,
            command: commandName,
            completed_at: null,
            error_code: null,
            error_detail: null,
            expected_version: 1,
            idempotency_key: input.idempotencyKey,
            metadata: {
              source: "operator_cli",
              creation_operation_id: input.creationOperationId,
            },
            request_sha256: requestSha256,
            result: {},
            status: "pending",
          },
        ],
        context
      )
    )
    ensure(operation?.status === "pending")
    if (!operation)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Repair operation is unavailable."
      )
    await catalog.softDeleteCatalogProductMediaItems(
      manifest.media.map((row) => row.id),
      {},
      context
    )
    await catalog.softDeleteCatalogVariantProfiles(
      manifest.variants.map((row) => row.id),
      {},
      context
    )
    await catalog.softDeleteCatalogProductProfiles(
      [manifest.profile.id],
      {},
      context
    )
    ensure(
      (
        await catalog.listCatalogProductProfiles(
          { product_id: input.productId },
          { take: 1 },
          context
        )
      ).length === 0
    )
    ensure(
      (
        await catalog.listCatalogVariantProfiles(
          { product_profile_id: manifest.profile.id },
          { take: 1 },
          context
        )
      ).length === 0
    )
    ensure(
      (
        await catalog.listCatalogProductMediaItems(
          { product_id: input.productId },
          { take: 1 },
          context
        )
      ).length === 0
    )
    const remainingAssets = ordered(
      await catalog.listCatalogMediaAssets(
        { id: manifest.assets.map((row) => row.id) },
        { take: 101 },
        context
      )
    )
    ensure(
      hashCatalogCommand(
        remainingAssets.map((row) => ({
          id: row.id,
          version: row.version,
          rowSha256: rowDigest(row),
        }))
      ) === hashCatalogCommand(manifest.assets)
    )
    const history = ordered(
      await catalog.listCatalogAuthoringOperations(
        {
          id: [manifest.creation.id, ...manifest.children.map((row) => row.id)],
        },
        { take: 103 },
        context
      )
    )
    ensure(
      hashCatalogCommand(
        history.map((row) => ({ id: row.id, rowSha256: rowDigest(row) }))
      ) ===
        hashCatalogCommand(
          ordered([manifest.creation, ...manifest.children]).map((row) => ({
            id: row.id,
            rowSha256: row.rowSha256,
          }))
        )
    )
    const result = {
      creationOperationId: input.creationOperationId,
      productId: input.productId,
      manifestSha256,
      profileId: manifest.profile.id,
      variantProfileIds: manifest.variants.map((row) => row.id),
      mediaLinkIds: manifest.media.map((row) => row.id),
      retainedAssetIds: manifest.assets.map((row) => row.id),
    }
    await catalog.completeCatalogAuthoringOperation(
      operation.id,
      result,
      context
    )
    return { operationId: operation.id, replayed: false, result }
  })
}
