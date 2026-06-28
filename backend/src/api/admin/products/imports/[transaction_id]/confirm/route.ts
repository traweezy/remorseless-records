import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import type { IWorkflowEngineService } from "@medusajs/framework/types";
import {
  importProductsWorkflowId,
  waitConfirmationProductImportStepId,
} from "@medusajs/core-flows";
import {
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const workflowEngineService = req.scope.resolve(
    Modules.WORKFLOW_ENGINE
  ) as IWorkflowEngineService;
  const transactionId = req.params.transaction_id;

  if (!transactionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "transaction_id is required to confirm a product import."
    );
  }

  await workflowEngineService.setStepSuccess({
    idempotencyKey: {
      action: TransactionHandlerType.INVOKE,
      transactionId,
      stepId: waitConfirmationProductImportStepId,
      workflowId: importProductsWorkflowId,
    },
    stepResponse: new StepResponse(true),
  });

  res.status(202).json({});
};
