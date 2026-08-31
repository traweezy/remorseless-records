import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type { CatalogMediaLifecycleStatus } from "@/modules/catalog/serializers"
import type { CatalogService } from "./reference-resolution"
import {
  readCatalogMediaAsset,
  readCatalogMediaAssetMutation,
  readCatalogMediaLifecycleOperationResult,
  readCatalogProductMediaItems,
  readCatalogTransactionOperationList,
  readCatalogTransactionOperationMutation,
  type CatalogMediaAssetPersistenceRecord,
  type CatalogTransactionOperationExpectation,
} from "./transaction-persistence-contracts"

const QUARANTINE_RETENTION_DAYS = 30
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000

export const catalogMediaLifecycleCommandSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
})

export type CatalogMediaLifecycleCommand =
  | "catalog.media.quarantine"
  | "catalog.media.restore"

export type CatalogMediaLifecycleInput = {
  actorId: string
  assetId: string
  command: CatalogMediaLifecycleCommand
  expectedVersion: number
  idempotencyKey: string
  requestSha256: string
}

export type CatalogMediaLifecycleSnapshot = {
  lifecycle_status: CatalogMediaLifecycleStatus
  purge_eligible_at: Date | null
  quarantined_at: Date | null
  quarantined_by: string | null
  version: number
}

export type CatalogMediaLifecycleResult = {
  assetId: string
  lifecycleStatus: CatalogMediaLifecycleStatus
  operationId: string
  purgeEligibleAt: string | null
  quarantinedAt: string | null
  replayed: boolean
  version: number
}

export type CatalogMediaLifecycleMutation = CatalogMediaLifecycleResult & {
  previous: CatalogMediaLifecycleSnapshot
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const toLifecycleStatus = (value: unknown): CatalogMediaLifecycleStatus =>
  value === "quarantined" ? "quarantined" : "active"

const resultFromRecord = (
  operationId: string,
  value: unknown
): CatalogMediaLifecycleResult => {
  const result = readCatalogMediaLifecycleOperationResult(value)
  return {
    assetId: result.assetId,
    lifecycleStatus: result.lifecycleStatus,
    operationId,
    purgeEligibleAt: result.purgeEligibleAt,
    quarantinedAt: result.quarantinedAt,
    replayed: true,
    version: result.version,
  }
}

const snapshotAsset = (
  asset: CatalogMediaAssetPersistenceRecord
): CatalogMediaLifecycleSnapshot => ({
  lifecycle_status: toLifecycleStatus(asset.lifecycle_status),
  purge_eligible_at: toDate(asset.purge_eligible_at),
  quarantined_at: toDate(asset.quarantined_at),
  quarantined_by: asset.quarantined_by ?? null,
  version: asset.version,
})

const assertUnlinked = async (
  catalogService: CatalogService,
  assetId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const links = readCatalogProductMediaItems(
    await catalogService.listCatalogProductMediaItems(
      { media_asset_id: assetId },
      { take: 2 },
      sharedContext
    ),
    { mediaAssetId: assetId },
    1
  )
  if (links.length) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Linked catalog media cannot be quarantined."
    )
  }
}

export const mutateCatalogMediaLifecycle = async (
  catalogService: CatalogService,
  input: CatalogMediaLifecycleInput,
  now = new Date()
): Promise<CatalogMediaLifecycleMutation> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const operationExpectation: CatalogTransactionOperationExpectation = {
      actorId: input.actorId,
      aggregateId: input.assetId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      metadata: { retention_days: QUARANTINE_RETENTION_DAYS },
      requestSha256: input.requestSha256,
      status: "pending",
    }
    const existingOperation = readCatalogTransactionOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        sharedContext
      )
    )
    if (existingOperation) {
      const matches =
        existingOperation.command === input.command &&
        existingOperation.aggregateId === input.assetId &&
        existingOperation.actorId === input.actorId &&
        existingOperation.expectedVersion === input.expectedVersion &&
        existingOperation.requestSha256 === input.requestSha256
      if (!matches || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog media lifecycle idempotency key cannot be replayed."
        )
      }
      const result = resultFromRecord(
        existingOperation.id,
        existingOperation.result
      )
      return {
        ...result,
        previous: {
          lifecycle_status: result.lifecycleStatus,
          purge_eligible_at: toDate(result.purgeEligibleAt),
          quarantined_at: toDate(result.quarantinedAt),
          quarantined_by: null,
          version: result.version,
        },
      }
    }

    const asset = readCatalogMediaAsset(
      await catalogService.retrieveCatalogMediaAsset(
        input.assetId,
        {},
        sharedContext
      ),
      input.assetId
    )
    if (asset.version !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The catalog media asset changed after it was loaded."
      )
    }
    const previous = snapshotAsset(asset)
    if (input.command === "catalog.media.quarantine") {
      if (previous.lifecycle_status !== "active") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog media asset is already quarantined."
        )
      }
      await assertUnlinked(catalogService, input.assetId, sharedContext)
    } else if (previous.lifecycle_status !== "quarantined") {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The catalog media asset is not quarantined."
      )
    }

    const operation = readCatalogTransactionOperationMutation(
      await catalogService.createCatalogAuthoringOperations(
        [
          {
            actor_id: input.actorId,
            aggregate_id: input.assetId,
            command: input.command,
            expected_version: input.expectedVersion,
            idempotency_key: input.idempotencyKey,
            metadata: {
              retention_days: QUARANTINE_RETENTION_DAYS,
            },
            request_sha256: input.requestSha256,
            result: {},
            status: "pending",
          },
        ],
        sharedContext
      ),
      operationExpectation
    )

    const quarantinedAt =
      input.command === "catalog.media.quarantine" ? now : null
    const purgeEligibleAt = quarantinedAt
      ? new Date(
          quarantinedAt.getTime() +
            QUARANTINE_RETENTION_DAYS * DAY_IN_MILLISECONDS
        )
      : null
    const lifecycleStatus: CatalogMediaLifecycleStatus = quarantinedAt
      ? "quarantined"
      : "active"
    const expectedAsset = {
      id: input.assetId,
      lifecycle_status: lifecycleStatus,
      purge_eligible_at: purgeEligibleAt,
      quarantined_at: quarantinedAt,
      quarantined_by: quarantinedAt ? input.actorId : null,
      version: previous.version + 1,
    }
    readCatalogMediaAssetMutation(
      await catalogService.updateCatalogMediaAssets(
        [expectedAsset],
        sharedContext
      ),
      expectedAsset
    )

    return {
      assetId: input.assetId,
      lifecycleStatus,
      operationId: operation.id,
      previous,
      purgeEligibleAt: toIso(purgeEligibleAt),
      quarantinedAt: toIso(quarantinedAt),
      replayed: false,
      version: previous.version + 1,
    }
  })

export const compensateCatalogMediaLifecycle = async (
  catalogService: CatalogService,
  mutation: Pick<
    CatalogMediaLifecycleMutation,
    "assetId" | "operationId" | "previous"
  >
): Promise<void> => {
  await catalogService.runCatalogTransaction(async (sharedContext) => {
    const operation = readCatalogTransactionOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { id: mutation.operationId },
        { take: 2 },
        sharedContext
      )
    )
    if (
      !operation ||
      operation.id !== mutation.operationId ||
      operation.status !== "pending"
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The media lifecycle compensation operation could not be verified."
      )
    }
    const expectedAsset = { id: mutation.assetId, ...mutation.previous }
    readCatalogMediaAssetMutation(
      await catalogService.updateCatalogMediaAssets(
        [expectedAsset],
        sharedContext
      ),
      expectedAsset
    )
    readCatalogTransactionOperationMutation(
      await catalogService.updateCatalogAuthoringOperations(
        [
          {
            completed_at: new Date(),
            error_code: "workflow_compensated",
            error_detail:
              "The prior catalog media lifecycle state was restored.",
            id: mutation.operationId,
            status: "compensated",
          },
        ],
        sharedContext
      ),
      { ...operation, id: mutation.operationId, status: "compensated" }
    )
  })
}
