import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import type {
  CreateProductWorkflowInputDTO,
  UpdateProductWorkflowInputDTO,
} from "@medusajs/framework/types";
import { batchProductsWorkflow } from "@medusajs/core-flows";
import { MedusaError, Modules } from "@medusajs/framework/utils";

type ProductImportPlan = {
  filename?: unknown;
  create?: unknown;
  update?: unknown;
};

const resolveLogger = (
  req: MedusaRequest
): {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
} => {
  try {
    return req.scope.resolve("logger") as {
      info?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    };
  } catch {
    return console;
  }
};

const parseImportPlan = (content: Buffer): {
  filename: string;
  create: CreateProductWorkflowInputDTO[];
  update: UpdateProductWorkflowInputDTO[];
} => {
  const parsed = JSON.parse(content.toString("utf-8")) as ProductImportPlan;

  if (!Array.isArray(parsed.create) || !Array.isArray(parsed.update)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The product import plan is invalid."
    );
  }

  return {
    filename:
      typeof parsed.filename === "string" && parsed.filename.trim().length > 0
        ? parsed.filename
        : "products-import.csv",
    create: parsed.create as CreateProductWorkflowInputDTO[],
    update: parsed.update as UpdateProductWorkflowInputDTO[],
  };
};

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const transactionId = req.params.transaction_id;

  if (!transactionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "transaction_id is required to confirm a product import."
    );
  }

  const logger = resolveLogger(req);
  const fileModuleService = req.scope.resolve(Modules.FILE) as {
    getAsBuffer: (id: string) => Promise<Buffer>;
    deleteFiles: (id: string | string[]) => Promise<void>;
  };

  let plan: ReturnType<typeof parseImportPlan>;

  try {
    const content = await fileModuleService.getAsBuffer(transactionId);
    plan = parseImportPlan(content);
  } catch (error) {
    logger.error?.(
      `[admin][products/imports] failed to read import plan ${transactionId}: ${
        (error as Error)?.message ?? "unknown error"
      }`,
      error
    );
    throw error;
  }

  logger.info?.(
    `[admin][products/imports] confirming import plan ${transactionId} for ${
      plan.filename
    } (toCreate=${plan.create.length}, toUpdate=${plan.update.length})`
  );

  try {
    await batchProductsWorkflow(req.scope).run({
      input: {
        create: plan.create,
        update: plan.update,
      },
    });

    await fileModuleService.deleteFiles(transactionId);

    logger.info?.(
      `[admin][products/imports] confirmed import plan ${transactionId} for ${
        plan.filename
      } (toCreate=${plan.create.length}, toUpdate=${plan.update.length})`
    );

    res.status(202).json({
      summary: {
        toCreate: plan.create.length,
        toUpdate: plan.update.length,
      },
    });
  } catch (error) {
    logger.error?.(
      `[admin][products/imports] failed to confirm import plan ${transactionId}: ${
        (error as Error)?.message ?? "unknown error"
      }`,
      error
    );
    throw error;
  }
};
