import type { StockStatus } from "@/types/product"

export const LOW_STOCK_THRESHOLD = 5

const normalizeStockStatus = (value: string | null | undefined): StockStatus | null => {
  if (!value) {
    return null
  }

  const normalized = value.toLowerCase().trim()
  if (["in_stock", "instock", "available", "backorder"].includes(normalized)) {
    return "in_stock"
  }
  if (["low_stock", "low", "limited", "scarce"].includes(normalized)) {
    return "low_stock"
  }
  if (["sold_out", "out_of_stock", "out-of-stock", "oos", "unavailable"].includes(normalized)) {
    return "sold_out"
  }

  return null
}

export type VariantStockInput = {
  inventoryQuantity?: number | null
  manageInventory?: boolean | null
  allowBackorder?: boolean | null
  stockStatus?: string | null
}

export const resolveVariantStockStatus = ({
  inventoryQuantity,
  manageInventory,
  allowBackorder,
  stockStatus,
}: VariantStockInput): { status: StockStatus; inStock: boolean } => {
  const normalizedStatus = normalizeStockStatus(stockStatus)
  const quantity = typeof inventoryQuantity === "number" && Number.isFinite(inventoryQuantity)
    ? inventoryQuantity
    : null

  if (quantity !== null) {
    if (quantity <= 0) {
      return { status: "sold_out", inStock: false }
    }
    if (quantity <= LOW_STOCK_THRESHOLD) {
      return { status: "low_stock", inStock: true }
    }
    return { status: "in_stock", inStock: true }
  }

  if (normalizedStatus) {
    return {
      status: normalizedStatus,
      inStock: normalizedStatus !== "sold_out",
    }
  }

  if (allowBackorder === true) {
    return { status: "in_stock", inStock: true }
  }

  if (manageInventory === false) {
    return { status: "in_stock", inStock: true }
  }

  return { status: "unknown", inStock: true }
}

export type StockSummaryInput = {
  stockStatus?: StockStatus | null
  inStock?: boolean
}

export const summarizeStockStatus = (variants: StockSummaryInput[]): StockStatus => {
  if (!variants.length) {
    return "unknown"
  }

  const statuses = variants.map((variant) =>
    variant.stockStatus ?? (variant.inStock ? "in_stock" : "sold_out")
  )
  const normalized = statuses.filter((status) => status !== "unknown")

  if (!normalized.length) {
    return "unknown"
  }

  if (normalized.every((status) => status === "sold_out")) {
    return "sold_out"
  }

  const available = normalized.filter((status) => status !== "sold_out")
  if (!available.length) {
    return "sold_out"
  }

  if (available.some((status) => status === "low_stock")) {
    return "low_stock"
  }

  return "in_stock"
}
