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
} from "../utils"

const listQuerySchema = z.object({
  kind: z.enum(catalogReferenceKindValues).optional(),
  q: z.string().trim().optional(),
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(["rank", "label", "kind", "created_at", "updated_at"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
})

const referenceCreateSchema = z.object({
  kind: z.enum(catalogReferenceKindValues),
  label: z.string().trim().min(1),
  value: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  rank: z.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const { kind, q, active, limit, offset, order, direction } =
    listQuerySchema.parse(req.query)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const take = limit ?? 100
  const skip = offset ?? 0
  const sortField = order ?? "rank"
  const sortDirection = (direction ?? "asc").toUpperCase() as "ASC" | "DESC"
  const filters: Record<string, unknown> = {}
  if (kind) {
    filters.kind = kind
  }
  if (active !== undefined) {
    filters.is_active = active
  }

  const [rawValues, rawCount] =
    await catalogService.listAndCountCatalogReferenceValues(filters, {
      skip: q ? 0 : skip,
      take: q ? Math.max(take + skip, 500) : take,
      order: { [sortField]: sortDirection },
    })

  const needle = q?.toLowerCase() ?? null
  const values = needle
    ? rawValues.filter((value) => {
        const label = value.label?.toLowerCase() ?? ""
        const slug = value.value?.toLowerCase() ?? ""
        return label.includes(needle) || slug.includes(needle)
      })
    : rawValues
  const count = needle ? values.length : rawCount

  res.status(200).json({
    values: values.slice(skip, skip + take).map(serializeCatalogReferenceValue),
    count,
    offset: skip,
    limit: take,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const parsed = referenceCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog reference payload"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  const value =
    toNullableString(parsed.data.value) ??
    slugify(parsed.data.label, parsed.data.kind)
  const createdResult = await catalogService.createCatalogReferenceValues([
    {
      kind: parsed.data.kind,
      label: parsed.data.label.trim(),
      value,
      description: toNullableString(parsed.data.description),
      rank: parsed.data.rank ?? 0,
      is_active: parsed.data.isActive ?? true,
      metadata: coerceJsonRecord(parsed.data.metadata),
    },
  ])
  const created = Array.isArray(createdResult)
    ? createdResult[0]
    : createdResult

  if (!created) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to create catalog reference value"
    )
  }

  res.status(201).json({ value: serializeCatalogReferenceValue(created) })
}
