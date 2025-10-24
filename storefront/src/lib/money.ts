export const formatAmount = (currency: string, amount: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount / 100)
