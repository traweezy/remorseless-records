import { formatAmount } from "@/lib/money"
import type { StockStatus, VariantOption } from "@/types/product"

type ProductCardPriceInput = {
  currency: string | null
  indexedMax: number | null
  indexedMin: number | null
  stockStatus: StockStatus
  variants: readonly VariantOption[]
}

export type ProductCardPrice = {
  currency: string
  label: string
  max: number
  min: number
}

const isFiniteAmount = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value)

export const resolveProductCardPrice = ({
  currency,
  indexedMax,
  indexedMin,
  stockStatus,
  variants,
}: ProductCardPriceInput): ProductCardPrice | null => {
  if (stockStatus === "sold_out") {
    return null
  }

  const purchasable = variants.filter(
    (variant) =>
      variant.inStock && variant.hasPrice && Number.isFinite(variant.amount)
  )
  const amounts = purchasable.map((variant) => variant.amount)
  const min = amounts.length ? Math.min(...amounts) : indexedMin
  const max = amounts.length ? Math.max(...amounts) : indexedMax
  const resolvedCurrency = purchasable[0]?.currency ?? currency

  if (!isFiniteAmount(min) || !isFiniteAmount(max) || !resolvedCurrency) {
    return null
  }

  const normalizedMin = Math.min(min, max)
  const normalizedMax = Math.max(min, max)
  const label =
    normalizedMin === normalizedMax
      ? formatAmount(resolvedCurrency, normalizedMin)
      : `${formatAmount(resolvedCurrency, normalizedMin)}–${formatAmount(
          resolvedCurrency,
          normalizedMax
        )}`

  return {
    currency: resolvedCurrency,
    label,
    max: normalizedMax,
    min: normalizedMin,
  }
}
