import type { VariantOption } from "@/types/product"

export const resolveDefaultVariantId = (
  variants: readonly VariantOption[]
): string => {
  const purchasable = variants.find(
    (variant) => variant.inStock && variant.hasPrice
  )
  if (purchasable) {
    return purchasable.id
  }

  const priced = variants.find((variant) => variant.hasPrice)
  if (priced) {
    return priced.id
  }

  return variants[0]?.id ?? ""
}
