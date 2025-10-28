import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows";

type ImportProductsBody = {
  originalname?: string;
  original_name?: string;
  filename?: string;
  fileName?: string;
  file_key?: string;
  fileKey?: string;
  key?: string;
};

export const POST = async (
  req: MedusaRequest<ImportProductsBody>,
  res: MedusaResponse
): Promise<void> => {
  const body =
    req.validatedBody ??
    ((req.body as ImportProductsBody | undefined) ?? {});

  const logger =
    (() => {
      try {
        return req.scope.resolve("logger") as {
          info?: (...args: unknown[]) => void;
          warn?: (...args: unknown[]) => void;
          error?: (...args: unknown[]) => void;
        };
      } catch {
        return console;
      }
    })() ?? console;

  logger.info?.(
    "[admin][products/imports] incoming body",
    JSON.stringify(body)
  );

  const resolvedKey =
    body.file_key ??
    body.fileKey ??
    body.key ??
    body.filename ??
    body.fileName;

  if (!resolvedKey) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "file_key is required to start the import. Upload the CSV first to obtain it."
    );
  }

  logger.info?.(
    "[admin][products/imports] resolved file key",
    resolvedKey
  );

  const filename =
    body.originalname ??
    body.original_name ??
    body.filename ??
    body.fileName ??
    body.file_key ??
    body.fileKey ??
    body.key ??
    "products-import.csv";

  const { result, transaction } = await importProductsAsChunksWorkflow(
    req.scope
  ).run({
    input: {
      filename,
      fileKey: resolvedKey,
    },
  });

  logger.info?.(
    "[admin][products/imports] workflow started",
    JSON.stringify({
      filename,
      transactionId: transaction.transactionId,
      summary: result,
    })
  );

  res
    .status(202)
    .json({ transaction_id: transaction.transactionId, summary: result });
};
