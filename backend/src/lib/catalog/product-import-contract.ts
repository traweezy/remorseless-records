import { createHash } from "node:crypto"

import type {
  CreateProductWorkflowInputDTO,
  UpdateProductWorkflowInputDTO,
} from "@medusajs/framework/types"
import { MedusaError, productValidators } from "@medusajs/framework/utils"

import { readIsoTimestamp } from "../provider-boundary/primitives"
import {
  asUnknownRecord,
  readProviderDataRecords,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"
import { MAX_UPLOAD_BYTES } from "../uploads/constraints"

export const MAX_PRODUCT_IMPORT_BYTES = MAX_UPLOAD_BYTES
export const MAX_PRODUCT_IMPORT_COLUMNS = 256
export const MAX_PRODUCT_IMPORT_OPERATIONS = 5_000
export const MAX_PRODUCT_IMPORT_ROWS = 25_000
export const PRODUCT_IMPORT_PLAN_TTL_MS = 24 * 60 * 60 * 1_000

const MAX_IMPORT_TEXT_LENGTH = 200
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000

export type NormalizedProductRecord = UnknownRecord & {
  handle?: string
  id?: string
  option_ids?: string[]
  options?: UnknownRecord[]
  variants?: Array<UnknownRecord & { id?: string; sku?: string }>
}

export type NormalizedProductTree = {
  toCreate: Record<string, NormalizedProductRecord>
  toUpdate: Record<string, NormalizedProductRecord>
}

export type ProductImportPlan = {
  create: CreateProductWorkflowInputDTO[]
  filename: string
  generatedAt: string
  update: Array<UpdateProductWorkflowInputDTO & { id: string }>
}

export type ProductLookupRow = {
  handle: string
  id: string
  options: Array<{
    createdAt: string
    id: string
    title: string
    values: string[]
  }>
  variants: Array<{
    id: string
    sku: string | null
  }>
}

const invalidImport = (): never => {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The product import data is invalid."
  )
}

const boundedText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 &&
    normalized.length <= MAX_IMPORT_TEXT_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null
}

const normalizedFilename = (value: unknown): string | null => {
  const normalized = boundedText(value)
  if (!normalized) {
    return null
  }
  const basename = normalized.replaceAll("\\", "/").split("/").at(-1)?.trim()
  return basename && basename !== "." && basename !== ".." ? basename : null
}

export const normalizeProductImportFilename = (value: unknown): string =>
  normalizedFilename(value) ?? "products-import.csv"

export const readProductImportFileKey = (value: unknown): string => {
  const normalized = boundedText(value)
  return normalized && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : invalidImport()
}

export const readProductImportBuffer = (value: unknown): string => {
  if (
    !Buffer.isBuffer(value) ||
    value.length === 0 ||
    value.length > MAX_PRODUCT_IMPORT_BYTES
  ) {
    return invalidImport()
  }
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(value)
    return content.includes("\u0000") ? invalidImport() : content
  } catch {
    return invalidImport()
  }
}

export const readCsvMatrix = (value: unknown): string[][] => {
  if (!Array.isArray(value) || value.length > MAX_PRODUCT_IMPORT_ROWS + 1) {
    return invalidImport()
  }
  return value.map((row) => {
    if (!Array.isArray(row) || row.length > MAX_PRODUCT_IMPORT_COLUMNS) {
      return invalidImport()
    }
    return row.map((cell) =>
      typeof cell === "string" ? cell : invalidImport()
    )
  })
}

export const readCsvRecords = (
  value: unknown
): Array<Record<string, string>> => {
  let records: UnknownRecord[]
  try {
    records = readRecordArray(value, { context: "Product import CSV" })
  } catch {
    return invalidImport()
  }
  if (records.length > MAX_PRODUCT_IMPORT_ROWS) {
    return invalidImport()
  }
  return records.map((record) => {
    if (Object.keys(record).length > MAX_PRODUCT_IMPORT_COLUMNS) {
      return invalidImport()
    }
    const normalized: Record<string, string> = {}
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry !== "string") {
        return invalidImport()
      }
      normalized[key] = entry
    }
    return normalized
  })
}

const readProductMap = (
  value: unknown
): Record<string, NormalizedProductRecord> => {
  const record = asUnknownRecord(value)
  if (!record || Object.keys(record).length > MAX_PRODUCT_IMPORT_OPERATIONS) {
    return invalidImport()
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, product]) => {
      const normalized = asUnknownRecord(product)
      return boundedText(key) && normalized
        ? [key, normalized as NormalizedProductRecord]
        : invalidImport()
    })
  )
}

export const readNormalizedProductTree = (
  value: unknown
): NormalizedProductTree => {
  const record = asUnknownRecord(value)
  if (
    !record ||
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, "toCreate") ||
    !Object.hasOwn(record, "toUpdate")
  ) {
    return invalidImport()
  }
  const tree = {
    toCreate: readProductMap(record.toCreate),
    toUpdate: readProductMap(record.toUpdate),
  }
  return Object.keys(tree.toCreate).length +
    Object.keys(tree.toUpdate).length <=
    MAX_PRODUCT_IMPORT_OPERATIONS
    ? tree
    : invalidImport()
}

const parseProductOperations = ({
  create,
  update,
}: {
  create: unknown
  update: unknown
}): Pick<ProductImportPlan, "create" | "update"> => {
  if (!Array.isArray(create) || !Array.isArray(update)) {
    return invalidImport()
  }
  const operationCount = create.length + update.length
  if (operationCount === 0 || operationCount > MAX_PRODUCT_IMPORT_OPERATIONS) {
    return invalidImport()
  }
  try {
    const parsedCreate = create.map((product) =>
      productValidators.CreateProduct.parse(product)
    )
    const parsedUpdate = update.map((product) =>
      productValidators.UpdateProduct.parse(product)
    )
    const updateIds = parsedUpdate.map((product) => product.id)
    if (new Set(updateIds).size !== updateIds.length) {
      return invalidImport()
    }
    return {
      create: parsedCreate as CreateProductWorkflowInputDTO[],
      update: parsedUpdate as Array<
        UpdateProductWorkflowInputDTO & { id: string }
      >,
    }
  } catch {
    return invalidImport()
  }
}

export const createProductImportPlan = ({
  create,
  filename,
  generatedAt = new Date().toISOString(),
  update,
}: {
  create: unknown
  filename: unknown
  generatedAt?: unknown
  update: unknown
}): ProductImportPlan => {
  const safeFilename = normalizeProductImportFilename(filename)
  const normalizedGeneratedAt = readIsoTimestamp(generatedAt)
  if (!normalizedGeneratedAt) {
    return invalidImport()
  }
  return {
    ...parseProductOperations({ create, update }),
    filename: safeFilename,
    generatedAt: normalizedGeneratedAt,
  }
}

export const parseProductImportPlan = (
  value: unknown,
  nowMs = Date.now()
): ProductImportPlan => {
  const content = readProductImportBuffer(value)
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return invalidImport()
  }
  const record = asUnknownRecord(parsed)
  const exactKeys = ["create", "filename", "generatedAt", "update"]
  if (
    !record ||
    Object.keys(record).length !== exactKeys.length ||
    exactKeys.some((key) => !Object.hasOwn(record, key)) ||
    normalizedFilename(record.filename) !== record.filename
  ) {
    return invalidImport()
  }
  const plan = createProductImportPlan({
    create: record.create,
    filename: record.filename,
    generatedAt: record.generatedAt,
    update: record.update,
  })
  const generatedAtMs = Date.parse(plan.generatedAt)
  if (
    generatedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    generatedAtMs < nowMs - PRODUCT_IMPORT_PLAN_TTL_MS
  ) {
    return invalidImport()
  }
  return plan
}

export const readProductLookupRows = (
  value: unknown,
  expectedHandles: readonly string[]
): ProductLookupRow[] => {
  let records: UnknownRecord[]
  try {
    records = readProviderDataRecords(value, "Product import lookup")
  } catch {
    return invalidImport()
  }
  const expected = new Set(expectedHandles)
  const seenIds = new Set<string>()
  const seenHandles = new Set<string>()
  return records.map((record) => {
    const id = boundedText(record.id)
    const handle = boundedText(record.handle)
    if (
      !id?.startsWith("prod_") ||
      !handle ||
      !expected.has(handle) ||
      seenIds.has(id) ||
      seenHandles.has(handle)
    ) {
      return invalidImport()
    }
    seenIds.add(id)
    seenHandles.add(handle)
    try {
      const seenOptionIds = new Set<string>()
      const options = readRecordArray(record.options, {
        context: "Product import option lookup",
        optional: true,
      }).map((option) => {
        const optionId = boundedText(option.id)
        const title = boundedText(option.title)
        const createdAt = readIsoTimestamp(option.created_at)
        if (
          !optionId?.startsWith("opt_") ||
          !title ||
          !createdAt ||
          seenOptionIds.has(optionId)
        ) {
          return invalidImport()
        }
        seenOptionIds.add(optionId)
        const values = readRecordArray(option.values, {
          context: "Product import option value lookup",
          optional: true,
        }).map((value) => boundedText(value.value) ?? invalidImport())
        return { createdAt, id: optionId, title, values }
      })
      const seenVariantIds = new Set<string>()
      const variants = readRecordArray(record.variants, {
        context: "Product import variant lookup",
        optional: true,
      }).map((variant) => {
        const variantId = boundedText(variant.id)
        const sku =
          variant.sku === null || variant.sku === undefined
            ? null
            : boundedText(variant.sku)
        if (
          !variantId?.startsWith("variant_") ||
          (variant.sku !== null && variant.sku !== undefined && !sku) ||
          seenVariantIds.has(variantId)
        ) {
          return invalidImport()
        }
        seenVariantIds.add(variantId)
        return { id: variantId, sku }
      })
      return { handle, id, options, variants }
    } catch {
      return invalidImport()
    }
  })
}

const hashedFileId = (fileId: string): string =>
  createHash("sha256").update(readProductImportFileKey(fileId)).digest("hex")

export const productImportWorkflowTransactionId = (fileId: string): string =>
  `rr-product-import-${hashedFileId(fileId)}`

export const productImportLockKey = (fileId: string): string =>
  `product-import:${hashedFileId(fileId)}`

export const validateProductImportWorkflowResult = (
  value: unknown,
  plan: ProductImportPlan
): { created: number; updated: number } => {
  const record = asUnknownRecord(value)
  if (!record) {
    return invalidImport()
  }
  let created: UnknownRecord[]
  let updated: UnknownRecord[]
  try {
    created = readRecordArray(record.created, {
      context: "Product import workflow",
    })
    updated = readRecordArray(record.updated, {
      context: "Product import workflow",
    })
  } catch {
    return invalidImport()
  }
  const deleted = Array.isArray(record.deleted)
    ? record.deleted
    : invalidImport()
  const createdIds = created.map((product) => boundedText(product.id))
  const updatedIds = updated.map((product) => boundedText(product.id))
  const expectedUpdateIds = plan.update.map((product) => product.id)
  const updatedIdSet = new Set(updatedIds)
  if (
    deleted.length !== 0 ||
    created.length !== plan.create.length ||
    updated.length !== plan.update.length ||
    createdIds.some((id) => !id?.startsWith("prod_")) ||
    updatedIds.some((id) => !id?.startsWith("prod_")) ||
    new Set(createdIds).size !== createdIds.length ||
    updatedIdSet.size !== updatedIds.length ||
    expectedUpdateIds.some((id) => !updatedIdSet.has(id))
  ) {
    return invalidImport()
  }
  return { created: created.length, updated: updated.length }
}
