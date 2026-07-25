const assertSupportedCurrency = (currency: string): void => {
  const normalized = currency.trim().toLowerCase()
  if (normalized !== "usd") {
    throw new Error(`[stripe-units] Unsupported checkout currency: ${currency}`)
  }
}

export const toStripeMinorUnit = (
  amount: number,
  currency: string
): number => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("[stripe-units] Amount must be finite and non-negative.")
  }

  assertSupportedCurrency(currency)
  const minorAmount = Math.round(amount * 100)

  if (!Number.isSafeInteger(minorAmount)) {
    throw new Error("[stripe-units] Amount exceeds Stripe's safe range.")
  }
  return minorAmount
}
