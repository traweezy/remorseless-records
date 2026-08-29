import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { sendApiProblem } from "@/lib/http/correlation"

export const rejectCatalogHardDeletion = (
  req: MedusaRequest,
  res: MedusaResponse,
  resource: string
): void => {
  res.setHeader("Cache-Control", "private, no-store")
  sendApiProblem(req, res, {
    code: "catalog_hard_deletion_disabled",
    type: "urn:remorseless-records:problem:catalog-hard-deletion-disabled",
    title: "Catalog hard deletion is disabled",
    status: 409,
    detail: `Hard deletion of ${resource} is disabled. Use the supported versioned update, archive, restore, or quarantine workflow.`,
    instance: req.path,
  })
}
