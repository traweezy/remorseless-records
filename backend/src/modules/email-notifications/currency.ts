import { readFiniteNumber } from "../../lib/provider-boundary/primitives"

const numericAmount = (value: unknown): number | null => {
  const amount = readFiniteNumber(value)
  return amount !== null && amount >= 0 ? amount : null
}

export const formatCurrencyAmount = (
  value: unknown,
  currencyCode: unknown
): string | null => {
  const amount = numericAmount(value)
  const currency =
    typeof currencyCode === "string" ? currencyCode.trim().toUpperCase() : ""
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) {
    return null
  }

  try {
    return new Intl.NumberFormat("en-US", {
      currency,
      style: "currency",
    }).format(amount)
  } catch {
    return null
  }
}
