import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import type { ILockingModule, Logger } from "@medusajs/framework/types"
import { batchProductsWorkflow } from "@medusajs/core-flows"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import {
  guardNativeMediaOperation,
  nativeProductMediaMutationTargets,
} from "../../../../../../lib/catalog/native-media-guard"
import {
  MAX_PRODUCT_IMPORT_OPERATIONS,
  parseProductImportPlan,
  productImportLockKey,
  productImportWorkflowTransactionId,
  readProductImportFileKey,
  validateProductImportWorkflowResult,
} from "../../../../../../lib/catalog/product-import-contract"
import { asUnknownRecord } from "../../../../../../lib/provider-boundary/records"

type ConfirmationSummary = {
  toCreate: number
  toUpdate: number
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  if (!req.params.transaction_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "transaction_id is required to confirm a product import."
    )
  }
  const transactionId = readProductImportFileKey(req.params.transaction_id)
  const logger = req.scope.resolve<Logger>("logger")
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
  const fileModuleService = req.scope.resolve<{
    deleteFiles: (id: string | string[]) => Promise<void>
    getAsBuffer: (id: string) => Promise<unknown>
  }>(Modules.FILE)

  try {
    const summary = await locking.execute<ConfirmationSummary | null>(
      productImportLockKey(transactionId),
      async () => {
        const plan = parseProductImportPlan(
          await fileModuleService.getAsBuffer(transactionId)
        )
        const guarded = await guardNativeMediaOperation(
          req,
          res,
          nativeProductMediaMutationTargets(
            plan.update,
            MAX_PRODUCT_IMPORT_OPERATIONS
          ),
          async () => {
            logger.info?.(
              `[admin][products/imports] import confirmation started (toCreate=${plan.create.length}, toUpdate=${plan.update.length}).`
            )
            const workflowResult = await batchProductsWorkflow(req.scope).run({
              input: {
                create: plan.create,
                update: plan.update,
              },
              context: {
                transactionId:
                  productImportWorkflowTransactionId(transactionId),
              },
            })
            const acknowledgement = validateProductImportWorkflowResult(
              asUnknownRecord(workflowResult)?.result,
              plan
            )
            await fileModuleService.deleteFiles(transactionId)
            return {
              toCreate: acknowledgement.created,
              toUpdate: acknowledgement.updated,
            }
          }
        )
        return guarded.executed ? guarded.value : null
      },
      { timeout: 5 }
    )
    if (summary === null) return
    logger.info?.(
      `[admin][products/imports] import confirmation completed (toCreate=${summary.toCreate}, toUpdate=${summary.toUpdate}).`
    )
    res.setHeader("Cache-Control", "no-store")
    res.status(202).json({
      summary,
    })
  } catch (error) {
    logger.error?.("[admin][products/imports] import confirmation failed.")
    throw error
  }
}
