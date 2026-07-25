const STANDARD_BASE_AMOUNT = 5
const STANDARD_ADDITIONAL_AMOUNT = 0.5

export const estimateStandardShippingAmount = (itemCount: number): number => {
  const quantity = Math.max(0, Math.trunc(itemCount))
  if (quantity === 0) {
    return 0
  }
  return (
    Math.round(
      (STANDARD_BASE_AMOUNT +
        Math.max(0, quantity - 1) * STANDARD_ADDITIONAL_AMOUNT) *
        100
    ) / 100
  )
}
