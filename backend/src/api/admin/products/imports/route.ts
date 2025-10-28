import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows";
import { Modules } from "@medusajs/utils";
import { parse } from "csv-parse/sync";

type HeaderInstruction = {
  sourceIndex: number;
  targetIndex: number | null;
  metadataKey?: string;
};

type NormalizedCsvResult = {
  csv: string;
  renamedColumns: Array<{ from: string; to: string }>;
  droppedColumns: string[];
  metadataKeys: string[];
};

const LEGACY_METADATA_COLUMN_MAP: Record<string, string> = {
  "product collection title": "collection_title",
  "product collection handle": "collection_handle",
  "product type": "product_type",
  "product profile name": "product_profile_name",
  "product profile type": "product_profile_type",
  "variant inventory quantity": "variant_inventory_quantity",
};

const PRICE_HEADER_REGEX = /^price\s+(.+)$/i;
const OPTION_HEADER_REGEX = /^option\s+(\d+)\s+(name|value)$/i;
const IMAGE_HEADER_REGEX = /^image\s+(\d+)\s+url$/i;

const escapeCsvValue = (value: string): string => {
  const stringValue = value ?? "";
  const needsEscape = /[",\n\r]/.test(stringValue);
  const sanitized = stringValue.replace(/"/g, '""');
  return needsEscape ? `"${sanitized}"` : sanitized;
};

const normalizeHeaders = (
  headers: string[]
): {
  normalizedHeaders: string[];
  instructions: HeaderInstruction[];
  metadataIndex: number;
  renamedColumns: Array<{ from: string; to: string }>;
  droppedColumns: string[];
  metadataKeys: Set<string>;
} => {
  const normalizedHeaders: string[] = [];
  const instructions: HeaderInstruction[] = [];
  const renamedColumns: Array<{ from: string; to: string }> = [];
  const droppedColumns: string[] = [];
  const metadataKeys = new Set<string>();

  let metadataIndex = -1;

  headers.forEach((rawHeader, index) => {
    const header = rawHeader?.trim() ?? "";
    if (!header) {
      instructions.push({ sourceIndex: index, targetIndex: null });
      return;
    }

    const lower = header.toLowerCase();

    if (LEGACY_METADATA_COLUMN_MAP[lower]) {
      const metadataKey = LEGACY_METADATA_COLUMN_MAP[lower];
      metadataKeys.add(metadataKey);
      instructions.push({
        sourceIndex: index,
        targetIndex: null,
        metadataKey,
      });
      droppedColumns.push(header);
      return;
    }

    const priceMatch = PRICE_HEADER_REGEX.exec(header);
    if (priceMatch?.[1]) {
      const iso = priceMatch[1].trim();
      const target = `Variant Price ${iso}`;
      normalizedHeaders.push(target);
      const targetIndex = normalizedHeaders.length - 1;
      instructions.push({ sourceIndex: index, targetIndex });
      renamedColumns.push({ from: header, to: target });
      return;
    }

    const optionMatch = OPTION_HEADER_REGEX.exec(header);
    if (optionMatch?.[1]) {
      const optionNumber = optionMatch[1];
      const optionSegment =
        optionMatch[2]?.toLowerCase() === "name" ? "Name" : "Value";
      const target = `Variant Option ${optionNumber} ${optionSegment}`;
      normalizedHeaders.push(target);
      const targetIndex = normalizedHeaders.length - 1;
      instructions.push({ sourceIndex: index, targetIndex });
      renamedColumns.push({ from: header, to: target });
      return;
    }

    const imageMatch = IMAGE_HEADER_REGEX.exec(header);
    if (imageMatch?.[1]) {
      const imageNumber = imageMatch[1];
      const target = `Product Image ${imageNumber}`;
      normalizedHeaders.push(target);
      const targetIndex = normalizedHeaders.length - 1;
      instructions.push({ sourceIndex: index, targetIndex });
      renamedColumns.push({ from: header, to: target });
      return;
    }

    normalizedHeaders.push(header);
    const targetIndex = normalizedHeaders.length - 1;
    instructions.push({ sourceIndex: index, targetIndex });

    if (header.toLowerCase() === "product metadata") {
      metadataIndex = targetIndex;
    }
  });

  if (metadataKeys.size > 0 && metadataIndex === -1) {
    metadataIndex = normalizedHeaders.length;
    normalizedHeaders.push("Product Metadata");
  }

  return {
    normalizedHeaders,
    instructions,
    metadataIndex,
    renamedColumns,
    droppedColumns,
    metadataKeys,
  };
};

const normalizeSemicolonDelimitedCsv = (
  csvText: string
): NormalizedCsvResult => {
  const records = parse(csvText, {
    delimiter: ";",
    relax_column_count: true,
  }) as string[][];

  if (!records.length) {
    return {
      csv: csvText,
      renamedColumns: [],
      droppedColumns: [],
      metadataKeys: [],
    };
  }

  const nonEmptyRecords =
    records.length > 1
      ? records.filter((row, idx) =>
          idx === 0 ? true : row.some((cell) => (cell ?? "").trim().length > 0)
        )
      : records;

  const headerRow = nonEmptyRecords[0];
  if (!headerRow) {
    return {
      csv: csvText,
      renamedColumns: [],
      droppedColumns: [],
      metadataKeys: [],
    };
  }
  const { normalizedHeaders, instructions, metadataIndex, renamedColumns, droppedColumns, metadataKeys } =
    normalizeHeaders(headerRow);

  const handleIndex = normalizedHeaders.findIndex(
    (header) => header.toLowerCase() === "product handle"
  );

  const normalizeHandleValue = (value: string): string => {
    if (!value) {
      return value;
    }

    const downcased = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const slug = downcased
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");

    if (slug.length === 0) {
      const fallback = downcased.replace(/[^a-z0-9]/g, "");
      return fallback || "product";
    }

    return slug;
  };

  const metadataNamespace = "legacy_import";

  const normalizedRows = nonEmptyRecords.slice(1).map((row) => {
    const normalizedRow = new Array(normalizedHeaders.length).fill("");
    const extraMetadata: Record<string, unknown> = {};

    instructions.forEach((instruction) => {
      const rawValue = row[instruction.sourceIndex] ?? "";
      if (instruction.targetIndex === null) {
        if (instruction.metadataKey && rawValue.trim().length > 0) {
          extraMetadata[instruction.metadataKey] = rawValue;
        }
        return;
      }

      normalizedRow[instruction.targetIndex] = rawValue;
    });

    if (handleIndex !== -1) {
      const originalHandle = normalizedRow[handleIndex] ?? "";
      if (originalHandle) {
        const slugifiedHandle = normalizeHandleValue(originalHandle);
        if (slugifiedHandle !== originalHandle) {
          normalizedRow[handleIndex] = slugifiedHandle;
        }
      }
    }

    if (metadataIndex !== -1) {
      const existingRaw = normalizedRow[metadataIndex];
      let existingMetadata: Record<string, unknown> = {};

      if (existingRaw && existingRaw.trim().length > 0) {
        try {
          existingMetadata = JSON.parse(existingRaw);
        } catch {
          existingMetadata = { value: existingRaw };
        }
      }

      if (Object.keys(extraMetadata).length > 0) {
        const legacy =
          typeof existingMetadata[metadataNamespace] === "object" &&
          existingMetadata[metadataNamespace] !== null &&
          !Array.isArray(existingMetadata[metadataNamespace])
            ? (existingMetadata[metadataNamespace] as Record<string, unknown>)
            : {};

        existingMetadata[metadataNamespace] = {
          ...legacy,
          ...extraMetadata,
        };
      }

      normalizedRow[metadataIndex] =
        Object.keys(existingMetadata).length > 0
          ? JSON.stringify(existingMetadata)
          : "";
    }

    return normalizedRow;
  });

  const csvLines = [
    normalizedHeaders.map(escapeCsvValue).join(","),
    ...normalizedRows.map((row) =>
      row.map((value) => escapeCsvValue(value)).join(",")
    ),
  ];

  return {
    csv: csvLines.join("\n"),
    renamedColumns,
    droppedColumns,
    metadataKeys: Array.from(metadataKeys),
  };
};

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

      logger.info?.(
        `[admin][products/imports] delimiter check semicolons=${semicolonColumns} commas=${commaColumns} includesSemi=${csvText.includes(
          ";"
        )} shouldNormalize=${shouldNormalize}`
      );

      if (shouldNormalize) {
        const normalized = normalizeSemicolonDelimitedCsv(csvText);

        const convertedKey = `${resolvedKey.replace(
          /\.csv$/i,
          ""
        )}-normalized.csv`;
        const createdFile = await fileModuleService.createFiles({
          filename: convertedKey,
          mimeType: "text/csv",
          content: Buffer.from(normalized.csv, "utf-8"),
        });

        normalizedKey = createdFile.id;

        await fileModuleService.deleteFiles(resolvedKey);

        logger.info?.(
          `[admin][products/imports] normalized CSV delimiter for ${resolvedKey} -> ${normalizedKey}`
        );
        if (normalized.renamedColumns.length) {
          logger.info?.(
            `[admin][products/imports] renamed columns ${JSON.stringify(normalized.renamedColumns)}`
          );
        }
        if (normalized.droppedColumns.length) {
          logger.info?.(
            `[admin][products/imports] stored legacy columns in metadata ${JSON.stringify(
              normalized.droppedColumns
            )}`
          );
        }

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
