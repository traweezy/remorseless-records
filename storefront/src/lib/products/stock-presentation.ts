import type { VariantOption } from "@/types/product"

export type StockChip = {
  label: string
  tone: "default" | "danger" | "warning"
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
      label: "Low stock",
      tone: "warning",
    }
  }

  return null
}
