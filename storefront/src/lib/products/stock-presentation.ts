import type { VariantOption } from "@/types/product"

export type StockChip = {
  label: string
  tone: "default" | "danger" | "warning"
}

const resolveLowStockLabel = (inventoryQuantity: number | null): string => {
  if (
    typeof inventoryQuantity !== "number" ||
    !Number.isSafeInteger(inventoryQuantity) ||
    inventoryQuantity <= 0
  ) {
    return "Low stock"
  }

  return `Only ${inventoryQuantity} left`
}

export const resolveStockChip = (variant: VariantOption): StockChip | null => {
  if (!variant.hasPrice) {
    return {
      label: "Unavailable",
      tone: "default",
    }
  }

  if (variant.stockStatus === "sold_out") {
    return {
      label: "Sold out",
      tone: "danger",
    }
  }

  if (
    variant.stockStatus === "low_stock" &&
    variant.lowStockBadgeEligible !== false
  ) {
    return {
      label: resolveLowStockLabel(variant.inventoryQuantity),
      tone: "warning",
    }
  }

  return null
}
