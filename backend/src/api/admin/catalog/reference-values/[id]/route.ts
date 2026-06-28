import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  catalogReferenceKindValues,
  serializeCatalogReferenceValue,
} from "@/modules/catalog/serializers"
import {
  coerceJsonRecord,
  slugify,
  toNullableString,
  type CatalogService,
} from "../../utils"

const referenceUpdateSchema = z.object({
  kind: z.enum(catalogReferenceKindValues).optional(),
  label: z.string().trim().min(1).optional(),
  value: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  rank: z.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog reference value id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const value = await catalogService.retrieveCatalogReferenceValue(id)
  if (!value) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog reference value not found"
    )
  }

  res.status(200).json({ value: serializeCatalogReferenceValue(value) })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = referenceUpdateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog reference payload"
    )
  }
  if (!Object.keys(parsed.data).length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "No updates provided")
  }

  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog reference value id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const existing = await catalogService.retrieveCatalogReferenceValue(id)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog reference value not found"
    )
  }

  const payload: Record<string, unknown> = {}
  if (parsed.data.kind !== undefined) {
    payload.kind = parsed.data.kind
  }
  if (parsed.data.label !== undefined) {
    payload.label = parsed.data.label.trim()
  }
  if (parsed.data.value !== undefined) {
    const currentKind = typeof existing.kind === "string" ? existing.kind : "reference"
    payload.value =
      toNullableString(parsed.data.value) ??
      slugify(parsed.data.label ?? existing.label, parsed.data.kind ?? currentKind)
  }
  if (parsed.data.description !== undefined) {
    payload.description = toNullableString(parsed.data.description)
  }
  if (parsed.data.rank !== undefined) {
    payload.rank = parsed.data.rank
  }
  if (parsed.data.isActive !== undefined) {
    payload.is_active = parsed.data.isActive
  }
  if (parsed.data.metadata !== undefined) {
    payload.metadata = coerceJsonRecord(parsed.data.metadata)
  }

  const updatedResult = await catalogService.updateCatalogReferenceValues([
    { id, ...payload },
  ])
  const updated = Array.isArray(updatedResult)
    ? updatedResult[0]
    : updatedResult
  if (!updated) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog reference value not found"
    )
  }

  res.status(200).json({ value: serializeCatalogReferenceValue(updated) })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const id = req.params.id
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Catalog reference value id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.deleteCatalogReferenceValues(id)
  res.sendStatus(204)
}
