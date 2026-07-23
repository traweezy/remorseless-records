import type { VariantOption } from "@/types/product"

export type StockChip = {
  label: string
  tone: string
}

export const resolveStockChip = (variant: VariantOption): StockChip | null => {
  if (!variant.hasPrice) {
    return {
      label: "Unavailable",
      tone: "border-border/70 bg-background/60 text-muted-foreground",
    }
  }

  if (variant.stockStatus === "sold_out") {
    return {
      label: "Sold out",
      tone: "border-destructive/70 bg-destructive/20 text-destructive",
    }
  }

  if (
    variant.stockStatus === "low_stock" &&
    variant.lowStockBadgeEligible !== false
  ) {
    return {
      label: "Low stock",
      tone: "border-amber-400/70 bg-amber-500/15 text-amber-200",
    }
  }

  return null
}
