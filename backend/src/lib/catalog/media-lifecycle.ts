import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import type {
  CatalogMediaAssetRecord,
  CatalogMediaLifecycleStatus,
  CatalogProductMediaItemRecord,
} from "@/modules/catalog/serializers"
import { coerceCatalogJsonRecord, firstCatalogResult } from "./normalization"
import type { CatalogService } from "./reference-resolution"

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
  const result = coerceCatalogJsonRecord(value)
  if (
    typeof result.assetId !== "string" ||
    typeof result.version !== "number" ||
    (result.lifecycleStatus !== "active" &&
      result.lifecycleStatus !== "quarantined")
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The stored catalog media lifecycle result is invalid."
    )
  }
  return {
    assetId: result.assetId,
    lifecycleStatus: result.lifecycleStatus,
    operationId,
    purgeEligibleAt:
      typeof result.purgeEligibleAt === "string"
        ? result.purgeEligibleAt
        : null,
    quarantinedAt:
      typeof result.quarantinedAt === "string" ? result.quarantinedAt : null,
    replayed: true,
    version: result.version,
  }
}

const snapshotAsset = (
  asset: CatalogMediaAssetRecord
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
  const links = (await catalogService.listCatalogProductMediaItems(
    { media_asset_id: assetId },
    { take: 1 },
    sharedContext
  )) as CatalogProductMediaItemRecord[]
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
    const existingOperation = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext
      )
    )[0]
    if (existingOperation) {
      const matches =
        existingOperation.command === input.command &&
        existingOperation.aggregate_id === input.assetId &&
        existingOperation.actor_id === input.actorId &&
        existingOperation.expected_version === input.expectedVersion &&
        existingOperation.request_sha256 === input.requestSha256
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

    const asset = (await catalogService.retrieveCatalogMediaAsset(
      input.assetId,
      {},
      sharedContext
    )) as CatalogMediaAssetRecord
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

    const [operation] = await catalogService.createCatalogAuthoringOperations(
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
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media lifecycle audit record was not created."
      )
    }

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
    const updated = await catalogService.updateCatalogMediaAssets(
      [
        {
          id: input.assetId,
          lifecycle_status: lifecycleStatus,
          purge_eligible_at: purgeEligibleAt,
          quarantined_at: quarantinedAt,
          quarantined_by: quarantinedAt ? input.actorId : null,
          version: previous.version + 1,
        },
      ],
      sharedContext
    )
    const updatedAsset = firstCatalogResult(updated) as
      | CatalogMediaAssetRecord
      | undefined
    if (!updatedAsset) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The catalog media lifecycle state was not updated."
      )
    }

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
    await catalogService.updateCatalogMediaAssets(
      [
        {
          id: mutation.assetId,
          ...mutation.previous,
        },
      ],
      sharedContext
    )
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: "workflow_compensated",
          error_detail: "The prior catalog media lifecycle state was restored.",
          id: mutation.operationId,
          status: "compensated",
        },
      ],
      sharedContext
    )
  })
}
