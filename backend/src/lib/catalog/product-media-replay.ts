import type { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import type {
  CatalogProductMediaMutationInput,
  CatalogProductMediaMutationResult,
} from "./product-media-contract"
import type { CatalogService } from "./reference-resolution"
import {
  readCatalogProductMediaOperationResult,
  readCatalogTransactionOperationList,
} from "./transaction-persistence-contracts"

export const readCommittedCatalogProductMediaReplay = async (
  catalog: CatalogService,
  input: CatalogProductMediaMutationInput,
  context?: Context<EntityManager>
): Promise<CatalogProductMediaMutationResult | null> => {
  const operation = readCatalogTransactionOperationList(
    await catalog.listCatalogAuthoringOperations(
      { idempotency_key: input.idempotencyKey },
      { take: 2 },
      context
    )
  )
  if (!operation) return null
  if (
    operation.command !== input.command ||
    operation.aggregateId !== input.aggregateId ||
    operation.actorId !== input.actorId ||
    operation.expectedVersion !== input.expectedVersion ||
    operation.idempotencyKey !== input.idempotencyKey ||
    operation.requestSha256 !== input.requestSha256 ||
    operation.status !== "succeeded"
  )
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "The catalog idempotency key cannot be replayed for this product media command."
    )
  const result = readCatalogProductMediaOperationResult(
    operation.result,
    input.aggregateId
  )
  if (result.version !== input.expectedVersion + 1)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The completed product media command result did not match the requested write."
    )
  return {
    createdAssetIds: [],
    operationId: operation.id,
    previous: { assets: [], items: [] },
    productId: input.aggregateId,
    replayed: true,
    result,
    version: result.version,
  }
}
