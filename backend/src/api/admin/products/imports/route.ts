import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import type {
  CreateProductWorkflowInputDTO,
  UpdateProductWorkflowInputDTO,
} from "@medusajs/framework/types";
import {
  CSVNormalizer,
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  productValidators,
} from "@medusajs/framework/utils";
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
  resolvedProducts: number;
  resolvedVariants: number;
  resolvedProductIds?: Array<{ handle: string; id: string }>;
  resolvedVariantIds?: Array<{ handle: string; sku: string; id: string }>;
  resolvedProductOptions?: Array<{
    handle: string;
    options: ResolvedProductOption[];
  }>;
};

export type ResolvedProductOption = {
  id: string;
  title: string;
  values: string[];
  createdAt: string;
};

type ProductImportPlan = {
  filename: string;
  generatedAt: string;
  create: CreateProductWorkflowInputDTO[];
  update: UpdateProductWorkflowInputDTO[];
};

type ProductImportPlanSummary = {
  rows: number;
  toCreate: number;
  toUpdate: number;
  recoveredUpdates: number;
};

type QueryGraph = {
  graph: (query: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: {
      take?: number;
      skip?: number;
    };
  }) => Promise<{ data: Array<Record<string, unknown>> }>;
};

type NormalizedProductRecord = Record<string, unknown> & {
  handle?: string;
  id?: string;
  option_ids?: string[];
  options?: Array<Record<string, unknown>>;
  variants?: Array<Record<string, unknown> & { id?: string; sku?: string }>;
};

type NormalizedProductTree = {
  toCreate: Record<string, NormalizedProductRecord>;
  toUpdate: Record<string, NormalizedProductRecord>;
};

const PRODUCT_LOOKUP_FIELDS = [
  "id",
  "handle",
  "options.id",
  "options.title",
  "options.created_at",
  "options.values.value",
  "variants.id",
  "variants.sku",
];

const normalizedOptionValue = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";

export const reuseResolvedProductOptions = (
  product: NormalizedProductRecord,
  existingOptions: ResolvedProductOption[]
): void => {
  if (!product.options?.length || !existingOptions.length) {
    return;
  }

  const optionIds = product.options.map((option) => {
    const title = nonEmptyString(option, "title");
    if (!title) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Product ${product.handle ?? product.id ?? "unknown"} has an option without a title.`
      );
    }

    const values = Array.isArray(option["values"])
      ? option["values"]
          .map(normalizedOptionValue)
          .filter((value) => value.length > 0)
      : [];
    const titleKey = normalizedOptionValue(title);
    const candidates = existingOptions
      .filter((candidate) => normalizedOptionValue(candidate.title) === titleKey)
      .filter((candidate) => {
        const candidateValues = new Set(
          candidate.values.map(normalizedOptionValue)
        );
        return values.every((value) => candidateValues.has(value));
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const candidate = candidates[0];

    if (!candidate) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Product ${product.handle ?? product.id ?? "unknown"} imports option ${title} with values that do not match an existing option. Add the option/value in Admin before rerunning the import.`
      );
    }
    return candidate.id;
  });

  product.option_ids = Array.from(new Set(optionIds));
  delete product.options;
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
      resolvedProducts: 0,
      resolvedVariants: 0,
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
      resolvedProducts: 0,
      resolvedVariants: 0,
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
    resolvedProducts: 0,
    resolvedVariants: 0,
  };
};

const csvFromRows = (headers: string[], rows: string[][]): string =>
  [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map((value) => escapeCsvValue(value)).join(",")),
  ].join("\n");

const ensureHeader = (headers: string[], rows: string[][], header: string) => {
  const existingIndex = headers.findIndex(
    (existing) => existing.toLowerCase() === header.toLowerCase()
  );
  if (existingIndex !== -1) {
    return existingIndex;
  }

  headers.push(header);
  rows.forEach((row) => row.push(""));
  return headers.length - 1;
};

const nonEmptyString = (
  value: Record<string, unknown> | undefined,
  key: string
): string | null => {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : null;
};

const normalizeCommaDelimitedCsv = async (
  req: MedusaRequest,
  csvText: string,
  inherited: Pick<
    NormalizedCsvResult,
    "renamedColumns" | "droppedColumns" | "metadataKeys"
  > = {
    renamedColumns: [],
    droppedColumns: [],
    metadataKeys: [],
  }
): Promise<NormalizedCsvResult> => {
  const records = parse(csvText, {
    relax_column_count: true,
  }) as string[][];

  if (!records.length) {
    return {
      csv: csvText,
      ...inherited,
      resolvedProducts: 0,
      resolvedVariants: 0,
    };
  }

  const headers = [...(records[0] ?? [])];
  const rows = records
    .slice(1)
    .filter((row) => row.some((cell) => (cell ?? "").trim().length > 0))
    .map((row) => [...row]);
  rows.forEach((row) => {
    while (row.length < headers.length) {
      row.push("");
    }
  });

  const productIdIndex = ensureHeader(headers, rows, "Product Id");
  const productHandleIndex = headers.findIndex(
    (header) => header.toLowerCase() === "product handle"
  );
  const variantIdIndex = ensureHeader(headers, rows, "Variant Id");
  const variantSkuIndex = headers.findIndex(
    (header) => header.toLowerCase() === "variant sku"
  );

  if (productHandleIndex === -1) {
    return {
      csv: csvFromRows(headers, rows),
      ...inherited,
      resolvedProducts: 0,
      resolvedVariants: 0,
    };
  }

  const handles = Array.from(
    new Set(
      rows
        .map((row) => row[productHandleIndex]?.trim())
        .filter((handle): handle is string => !!handle)
    )
  );
  if (!handles.length) {
    return {
      csv: csvFromRows(headers, rows),
      ...inherited,
      resolvedProducts: 0,
      resolvedVariants: 0,
    };
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph;
  const existingProductRows: Array<Record<string, unknown>> = [];
  const seenProductIds = new Set<string>();

  for (let index = 0; index < handles.length; index += 50) {
    const chunk = handles.slice(index, index + 50);
    const existingProducts = await query.graph({
      entity: "product",
      fields: PRODUCT_LOOKUP_FIELDS,
      filters: { handle: { $in: chunk } },
      pagination: { take: chunk.length },
    });

    existingProducts.data.forEach((product) => {
      const id = nonEmptyString(product, "id");
      if (id && seenProductIds.has(id)) {
        return;
      }
      if (id) {
        seenProductIds.add(id);
      }
      existingProductRows.push(product);
    });
  }

  if (existingProductRows.length === 0 && handles.length <= 100) {
    for (const handle of handles) {
      const existingProducts = await query.graph({
        entity: "product",
        fields: PRODUCT_LOOKUP_FIELDS,
        filters: { handle },
        pagination: { take: 1 },
      });

      existingProducts.data.forEach((product) => {
        const id = nonEmptyString(product, "id");
        if (id && seenProductIds.has(id)) {
          return;
        }
        if (id) {
          seenProductIds.add(id);
        }
        existingProductRows.push(product);
      });
    }
  }

  const productIdByHandle = new Map<string, string>();
  const variantIdByHandleSku = new Map<string, string>();
  const productOptionsByHandle = new Map<string, ResolvedProductOption[]>();
  existingProductRows.forEach((product) => {
    const handle = nonEmptyString(product, "handle");
    const id = nonEmptyString(product, "id");
    if (!handle || !id) {
      return;
    }
    productIdByHandle.set(handle, id);

    const options = product["options"];
    if (Array.isArray(options)) {
      const resolvedOptions = options.flatMap((option) => {
        if (!option || typeof option !== "object") {
          return [];
        }
        const optionRecord = option as Record<string, unknown>;
        const optionId = nonEmptyString(optionRecord, "id");
        const title = nonEmptyString(optionRecord, "title");
        if (!optionId || !title) {
          return [];
        }
        const optionValues = Array.isArray(optionRecord["values"])
          ? optionRecord["values"].flatMap((value) => {
              if (!value || typeof value !== "object") {
                return [];
              }
              const resolved = nonEmptyString(
                value as Record<string, unknown>,
                "value"
              );
              return resolved ? [resolved] : [];
            })
          : [];
        return [
          {
            id: optionId,
            title,
            values: optionValues,
            createdAt: nonEmptyString(optionRecord, "created_at") ?? "",
          },
        ];
      });
      if (resolvedOptions.length) {
        productOptionsByHandle.set(handle, resolvedOptions);
      }
    }

    const variants = product["variants"];
    if (!Array.isArray(variants)) {
      return;
    }
    variants.forEach((variant) => {
      if (!variant || typeof variant !== "object") {
        return;
      }
      const variantRecord = variant as Record<string, unknown>;
      const sku = nonEmptyString(variantRecord, "sku");
      const variantId = nonEmptyString(variantRecord, "id");
      if (sku && variantId) {
        variantIdByHandleSku.set(`${handle}\u0000${sku}`, variantId);
      }
    });
  });

  let resolvedProducts = 0;
  let resolvedVariants = 0;
  rows.forEach((row) => {
    const handle = row[productHandleIndex]?.trim();
    if (!handle) {
      return;
    }

    const productId = productIdByHandle.get(handle);
    if (productId && !row[productIdIndex]?.trim()) {
      row[productIdIndex] = productId;
      resolvedProducts += 1;
    }

    if (variantSkuIndex === -1 || row[variantIdIndex]?.trim()) {
      return;
    }

    const sku = row[variantSkuIndex]?.trim();
    const variantId = sku ? variantIdByHandleSku.get(`${handle}\u0000${sku}`) : null;
    if (variantId) {
      row[variantIdIndex] = variantId;
      resolvedVariants += 1;
    }
  });

  return {
    csv: csvFromRows(headers, rows),
    ...inherited,
    resolvedProducts,
    resolvedVariants,
    resolvedProductIds: Array.from(productIdByHandle.entries()).map(
      ([handle, id]) => ({ handle, id })
    ),
    resolvedVariantIds: Array.from(variantIdByHandleSku.entries()).flatMap(
      ([compoundKey, id]) => {
        const [handle, sku] = compoundKey.split("\u0000");
        return handle && sku ? [{ handle, sku, id }] : [];
      }
    ),
    resolvedProductOptions: Array.from(productOptionsByHandle.entries()).map(
      ([handle, options]) => ({ handle, options })
    ),
  };
};

const buildImportPlan = (
  filename: string,
  csvText: string,
  resolvedIds?: Pick<
    NormalizedCsvResult,
    | "resolvedProductIds"
    | "resolvedVariantIds"
    | "resolvedProductOptions"
  >
): {
  plan: ProductImportPlan;
  summary: ProductImportPlanSummary;
} => {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;

  const normalizedRows = rows.map((row, index) =>
    CSVNormalizer.preProcess(row, index + 1)
  );
  const normalizer = new CSVNormalizer(normalizedRows);
  const products = normalizer.proccess() as NormalizedProductTree;
  const productHandleCount = new Set(
    normalizedRows
      .map((row) => row["product handle"])
      .filter((handle): handle is string => Boolean(handle))
  ).size;
  const productIdByHandle = new Map<string, string>();
  const variantIdByHandleSku = new Map<string, string>();
  const productOptionsByHandle = new Map(
    resolvedIds?.resolvedProductOptions?.map(({ handle, options }) => [
      handle,
      options,
    ]) ?? []
  );
  const normalizedValue = (
    row: Record<string, unknown>,
    key: string
  ): string => {
    const value = row[key];
    return typeof value === "string" ? value.trim() : "";
  };

  normalizedRows.forEach((row) => {
    const normalizedRow = row as Record<string, unknown>;
    const handle = normalizedValue(normalizedRow, "product handle");
    const productId = normalizedValue(normalizedRow, "product id");
    if (handle && productId) {
      productIdByHandle.set(handle, productId);
    }

    const sku = normalizedValue(normalizedRow, "variant sku");
    const variantId = normalizedValue(normalizedRow, "variant id");
    if (handle && sku && variantId) {
      variantIdByHandleSku.set(`${handle}\u0000${sku}`, variantId);
    }
  });
  resolvedIds?.resolvedProductIds?.forEach(({ handle, id }) => {
    if (handle && id && !productIdByHandle.has(handle)) {
      productIdByHandle.set(handle, id);
    }
  });
  resolvedIds?.resolvedVariantIds?.forEach(({ handle, sku, id }) => {
    if (handle && sku && id && !variantIdByHandleSku.has(`${handle}\u0000${sku}`)) {
      variantIdByHandleSku.set(`${handle}\u0000${sku}`, id);
    }
  });

  let recoveredUpdates = 0;
  Object.entries(products.toCreate).forEach(([key, product]) => {
    const handle = typeof product.handle === "string" ? product.handle : key;
    const productId = productIdByHandle.get(handle);
    if (!productId) {
      return;
    }

    product.id = productId;
    if (product.variants) {
      product.variants = product.variants.map((variant) => {
        const sku = typeof variant.sku === "string" ? variant.sku : "";
        const variantId = sku
          ? variantIdByHandleSku.get(`${handle}\u0000${sku}`)
          : undefined;
        return variantId ? { ...variant, id: variantId } : variant;
      });
    }

    products.toUpdate[productId] = product;
    delete products.toCreate[key];
    recoveredUpdates += 1;
  });

  Object.values(products.toUpdate).forEach((product) => {
    const handle = typeof product.handle === "string" ? product.handle : "";
    const existingOptions = productOptionsByHandle.get(handle);
    if (existingOptions) {
      reuseResolvedProductOptions(product, existingOptions);
    }
  });

  const create = Object.values(products.toCreate).map((product) =>
    productValidators.CreateProduct.parse(product)
  ) as CreateProductWorkflowInputDTO[];
  const update = Object.values(products.toUpdate).map((product) =>
    productValidators.UpdateProduct.parse(product)
  ) as UpdateProductWorkflowInputDTO[];

  if (rows.length > 0 && create.length + update.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `CSV import did not produce product records (rows=${rows.length}, productHandles=${productHandleCount}).`
    );
  }

  return {
    plan: {
      filename,
      generatedAt: new Date().toISOString(),
      create,
      update,
    },
    summary: {
      rows: rows.length,
      toCreate: create.length,
      toUpdate: update.length,
      recoveredUpdates,
    },
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

  const filename =
    body.originalname ??
    body.original_name ??
    body.filename ??
    body.fileName ??
    resolvedKey ??
    "products-import.csv";

  logger.info?.(
    `[admin][products/imports] starting import ${filename} (key=${resolvedKey})`
  );

  const fileModuleService = (() => {
    try {
      return req.scope.resolve(Modules.FILE) as {
        createFiles: (input: {
          filename: string;
          content: string;
          mimeType: string;
        }) => Promise<{ id: string; url: string }>;
        getAsBuffer: (id: string) => Promise<Buffer>;
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

  if (!fileModuleService) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The file module is required to import products from an uploaded CSV."
    );
  }

  let importCsvText: string;
  let normalizedSummary: NormalizedCsvResult;

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

    const delimiterNormalized = shouldNormalize
      ? normalizeSemicolonDelimitedCsv(csvText)
      : {
          csv: csvText,
          renamedColumns: [],
          droppedColumns: [],
          metadataKeys: [],
          resolvedProducts: 0,
          resolvedVariants: 0,
        };
    const normalized = await normalizeCommaDelimitedCsv(
      req,
      delimiterNormalized.csv,
      delimiterNormalized
    );

    importCsvText = normalized.csv;
    normalizedSummary = normalized;

    logger.info?.(
      `[admin][products/imports] normalized CSV for ${resolvedKey} (delimiter=${
        shouldNormalize ? "semicolon" : "comma"
      }, resolvedProducts=${normalized.resolvedProducts}, resolvedVariants=${
        normalized.resolvedVariants
      })`
    );
  } catch (error) {
    logger.error?.(
      `[admin][products/imports] failed to prepare uploaded CSV: ${
        (error as Error)?.message ?? "unknown error"
      }`,
      error
    );
    throw error;
  }

  try {
    const { plan, summary } = buildImportPlan(
      filename,
      importCsvText,
      normalizedSummary
    );
    const planFile = await fileModuleService.createFiles({
      filename: `${filename.replace(/\.csv$/i, "")}-import-plan.json`,
      content: JSON.stringify(plan),
      mimeType: "application/json",
    });

    await fileModuleService.deleteFiles(resolvedKey);

    logger.info?.(
      `[admin][products/imports] import plan created for ${filename} (transaction=${
        planFile.id
      }, rows=${summary.rows}, toCreate=${summary.toCreate}, toUpdate=${summary.toUpdate}, resolvedProducts=${
        normalizedSummary.resolvedProducts
      }, resolvedVariants=${
        normalizedSummary.resolvedVariants
      }, recoveredUpdates=${summary.recoveredUpdates})`
    );

    res.status(202).json({ transaction_id: planFile.id, summary });
  } catch (error) {
    logger.error?.(
      `[admin][products/imports] import plan failed ${(error as Error)?.message}`,
      error
    );
    throw error;
  }
};
