import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { asUnknownRecord } from "../provider-boundary/records"
import { readCatalogVariantOwnerships } from "./persistence-contracts"

type NativeVariantQuery = {
  graph: (input: {
    entity: "variant"
    fields: string[]
    filters: { id: string[] }
    pagination: { take: number }
  }) => Promise<unknown>
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const queryChunkSize = 100
const invalid: () => never = () => {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The native Variant batch has invalid parent or update identifiers."
  )
}
const readIdentifier = (value: unknown): string =>
  typeof value === "string" && identifier.test(value) ? value : invalid()

// The registration runs Medusa's exact native validator and policy group first.
// Native upsert retains an existing Variant's persisted Product, so injecting
// the URL Product into its update DTO does not establish this identity boundary.
export const enforceNativeVariantBatchParentOwnership = async (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> => {
  const body = asUnknownRecord(req.validatedBody) ?? invalid()
  if (body.delete !== undefined && !Array.isArray(body.delete)) invalid()
  if (Array.isArray(body.delete) && body.delete.length) {
    // The existing delegate terminally rejects every nonempty delete list with
    // catalog_hard_deletion_disabled. Keep that precedence and its no-write path.
    next()
    return
  }

  const updates = body.update ?? []
  if (!Array.isArray(updates)) invalid()
  if (!updates.length) {
    next()
    return
  }
  const productId = readIdentifier(req.params.id)
  const variantIds = [
    ...new Set(
      updates.map((entry) =>
        readIdentifier((asUnknownRecord(entry) ?? invalid()).id)
      )
    ),
  ]
  const query = req.scope.resolve<NativeVariantQuery>(
    ContainerRegistrationKeys.QUERY
  )
  // Bound each graph result without adding a new native whole-batch size limit.
  // Check every chunk before next(), so a mixed batch cannot partially execute.
  for (let offset = 0; offset < variantIds.length; offset += queryChunkSize) {
    const chunk = variantIds.slice(offset, offset + queryChunkSize)
    const rows = readCatalogVariantOwnerships(
      await query.graph({
        entity: "variant",
        fields: ["id", "product_id"],
        filters: { id: chunk },
        pagination: { take: chunk.length + 1 },
      }),
      chunk
    )
    if (
      rows.length !== chunk.length ||
      rows.some((row) => row.productId !== productId)
    )
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "A requested Variant was not found for this Product."
      )
  }
  next()
}
