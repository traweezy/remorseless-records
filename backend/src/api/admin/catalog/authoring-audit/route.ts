import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { z } from "zod"

import {
  catalogAuthoringAuditStatuses,
  catalogAuthoringProductKinds,
} from "../../../../lib/catalog/authoring-audit"
import { loadCatalogAuthoringAudit } from "../../../../lib/catalog/load-authoring-audit"

const querySchema = z.object({
  kind: z.enum(catalogAuthoringProductKinds).optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(200).optional(),
  status: z.enum(catalogAuthoringAuditStatuses).optional(),
})

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const { kind, limit, offset, q, status } = querySchema.parse(req.query)
  const report = await loadCatalogAuthoringAudit(req.scope)

  const needle = q?.toLowerCase()
  const filteredItems = report.items.filter((item) => {
    if (kind && item.kind !== kind) {
      return false
    }
    if (status && item.status !== status) {
      return false
    }
    if (!needle) {
      return true
    }
    return (
      item.id.toLowerCase().includes(needle) ||
      item.title.toLowerCase().includes(needle) ||
      item.handle?.toLowerCase().includes(needle)
    )
  })

  res.setHeader("Cache-Control", "private, no-store")
  res.status(200).json({
    generatedAt: new Date().toISOString(),
    items: filteredItems.slice(offset, offset + limit),
    limit,
    offset,
    filteredCount: filteredItems.length,
    summary: report.summary,
  })
}
