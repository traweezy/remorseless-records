import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows";
import { Modules } from "@medusajs/utils";
import { parse } from "csv-parse/sync";

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
    `[admin][products/imports] incoming body ${JSON.stringify(body)}`
  );
  logger.info?.(
    `[admin][products/imports] headers ${JSON.stringify(req.headers)}`
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

  try {
    req.body = {
      ...(req.body ?? {}),
      file_key: resolvedKey,
      filename: body.filename ?? resolvedKey,
      originalname: body.originalname ?? body.original_name,
    } as ImportProductsBody;
  } catch {
    // noop: request body may be read-only
  }

  try {
    if (req.validatedBody) {
      (req.validatedBody as ImportProductsBody).file_key = resolvedKey;
    }
  } catch {
    // noop: validated body may be immutable
  }

  logger.info?.(
    `[admin][products/imports] resolved file key ${resolvedKey}`
  );
  logger.info?.(
    `[admin][products/imports] mutated body ${JSON.stringify(req.body)}`
  );

  const filename =
    body.originalname ??
    body.original_name ??
    body.filename ??
    body.fileName ??
    resolvedKey ??
    "products-import.csv";

  const fileModuleService = (() => {
    try {
      return req.scope.resolve(Modules.FILE) as {
        getAsBuffer: (id: string) => Promise<Buffer>;
        createFiles: (file: {
          filename: string;
          mimeType: string;
          content: Buffer | string;
        }) => Promise<{ id: string }>;
        deleteFiles: (id: string | string[]) => Promise<void>;
      };
    } catch (error) {
      logger.warn?.(
        `[admin][products/imports] unable to resolve file module: ${
          (error as Error)?.message ?? "unknown error"
        }`
      );
      return null;
    }
  })();

  let normalizedKey = resolvedKey;

  if (fileModuleService) {
    try {
      const originalBuffer = await fileModuleService.getAsBuffer(resolvedKey);
      const csvText = originalBuffer.toString("utf-8");

      const headerLine =
        csvText
          .split(/\r?\n/)
          .find((line) => line.trim().length > 0) ?? "";
      const semicolonColumns = headerLine.split(";").length;
      const commaColumns = headerLine.split(",").length;
      const shouldNormalize =
        semicolonColumns > 1 && commaColumns <= 1 && csvText.includes(";");

      if (shouldNormalize) {
        const records = parse(csvText, {
          delimiter: ";",
          relax_column_count: true,
        }) as string[][];

        const escapeValue = (value: string): string => {
          const safe = value ?? "";
          const sanitized = safe.replace(/"/g, '""');
          return /[",\n\r]/.test(sanitized)
            ? `"${sanitized}"`
            : sanitized;
        };

        const rebuilt = records
          .map((row) => row.map(escapeValue).join(","))
          .join("\n")
          .concat("\n");

        const convertedKey = `${resolvedKey.replace(
          /\.csv$/i,
          ""
        )}-normalized.csv`;
        const createdFile = await fileModuleService.createFiles({
          filename: convertedKey,
          mimeType: "text/csv",
          content: Buffer.from(rebuilt, "utf-8"),
        });

        normalizedKey = createdFile.id;

        await fileModuleService.deleteFiles(resolvedKey);

        logger.info?.(
          `[admin][products/imports] normalized CSV delimiter for ${resolvedKey} -> ${normalizedKey}`
        );

        try {
          if (req.body) {
            (req.body as ImportProductsBody).file_key = normalizedKey;
          }
          if (req.validatedBody) {
            (req.validatedBody as ImportProductsBody).file_key = normalizedKey;
          }
        } catch {
          // Body might be read-only; ignore
        }
      } else {
        logger.info?.(
          `[admin][products/imports] CSV delimiter already compatible for ${resolvedKey}`
        );
      }
    } catch (error) {
      logger.warn?.(
        `[admin][products/imports] failed to normalize CSV delimiter: ${
          (error as Error)?.message ?? "unknown error"
        }`
      );
    }
  }

  try {
    const { result, transaction } = await importProductsAsChunksWorkflow(
      req.scope
    ).run({
      input: {
        filename,
        fileKey: normalizedKey,
      },
    });

    logger.info?.(
      `[admin][products/imports] workflow started ${JSON.stringify({
        filename,
        transactionId: transaction.transactionId,
        summary: result,
      })}`
    );

    res
      .status(202)
      .json({ transaction_id: transaction.transactionId, summary: result });
  } catch (error) {
    logger.error?.(
      `[admin][products/imports] workflow failed ${(error as Error)?.message}`,
      error
    );
    throw error;
  }
};
