import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows";

type ImportProductsBody = {
  originalname?: string;
  filename?: string;
  file_key?: string;
};

export const POST = async (
  req: MedusaRequest<ImportProductsBody>,
  res: MedusaResponse
): Promise<void> => {
  const body = req.validatedBody ?? {};

  if (!body.file_key && typeof body.filename === "string" && body.filename.length) {
    body.file_key = body.filename;
  }

  if (!body.file_key) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "file_key is required to start the import. Upload the CSV first to obtain it."
    );
  }

  const filename =
    body.originalname ??
    body.filename ??
    body.file_key ??
    "products-import.csv";

  const { result, transaction } = await importProductsAsChunksWorkflow(
    req.scope
  ).run({
    input: {
      filename,
      fileKey: body.file_key,
    },
  });

  res
    .status(202)
    .json({ transaction_id: transaction.transactionId, summary: result });
};
