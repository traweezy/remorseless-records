type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const numericAmount = (value: unknown): number | null => {
  const record = asRecord(value);
  const candidate = record?.value ?? value;
  if (
    (typeof candidate !== "number" && typeof candidate !== "string") ||
    (typeof candidate === "string" && candidate.trim().length === 0)
  ) {
    return null;
  }
  const amount = Number(candidate);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

export const formatCurrencyAmount = (
  value: unknown,
  currencyCode: unknown,
): string | null => {
  const amount = numericAmount(value);
  const currency =
    typeof currencyCode === "string" ? currencyCode.trim().toUpperCase() : "";
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      currency,
      style: "currency",
    }).format(amount);
  } catch {
    return null;
  }
};
