type UnknownRecord = Record<string, unknown>

export type TaxProviderName = "stripe_tax" | "taxrate_io"

export type TaxQuoteIdentity = {
  calculationId: string | null
  fingerprint: string
  generation: number
  provider: TaxProviderName
  taxRatePercent: number | null
}

export class TaxQuoteIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaxQuoteIdentityError"
  }
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : ""

const valuesFrom = (value: unknown): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : []

const parseCode = (
  value: unknown
): Omit<TaxQuoteIdentity, "fingerprint" | "taxRatePercent"> | null => {
  if (typeof value !== "string") {
    return null
  }

  const [prefix, provider, generationValue, calculationValue, ...rest] =
    value.split(":")
  const generation = Number(generationValue?.slice(1))
  if (
    rest.length ||
    prefix !== "rr_tax" ||
    (provider !== "stripe_tax" && provider !== "taxrate_io") ||
    !generationValue?.startsWith("g") ||
    !Number.isSafeInteger(generation) ||
    generation <= 0
  ) {
    return null
  }

  const calculationId =
    calculationValue && /^taxcalc_[A-Za-z0-9]+$/.test(calculationValue)
      ? calculationValue
      : null

  return { calculationId, generation, provider }
}

const taxSubjectsFrom = (cart: UnknownRecord): UnknownRecord[] =>
  [...valuesFrom(cart.items), ...valuesFrom(cart.shipping_methods)]
    .map(asRecord)
    .filter((subject): subject is UnknownRecord => subject !== null)

export const taxQuoteIdentityFromCart = (value: unknown): TaxQuoteIdentity => {
  const cart = asRecord(value)
  if (!cart) {
    throw new TaxQuoteIdentityError("The cart tax snapshot is unavailable.")
  }

  const subjects = taxSubjectsFrom(cart)
  if (!subjects.length) {
    throw new TaxQuoteIdentityError("The cart has no taxable subjects.")
  }

  const lines = subjects.flatMap((subject) => {
    const taxLines = (Array.isArray(subject.tax_lines) ? subject.tax_lines : [])
      .map(asRecord)
      .filter((line): line is UnknownRecord => line !== null)
    if (!taxLines.length) {
      throw new TaxQuoteIdentityError(
        "Every cart item and shipping method must have a tax quote."
      )
    }
    return taxLines
  })

  const identities = lines.map((line) => {
    const code = parseCode(line.code)
    const data = asRecord(line.data)
    const fingerprint = text(data?.fingerprint)
    const generation = Number(data?.generation)
    const provider = text(data?.provider)
    const calculationId = text(data?.calculation_id) || null
    const rate = Number(line.rate)
    if (
      !code ||
      provider !== code.provider ||
      !Number.isSafeInteger(generation) ||
      generation !== code.generation ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(fingerprint) ||
      calculationId !== code.calculationId ||
      !Number.isFinite(rate) ||
      rate < 0
    ) {
      throw new TaxQuoteIdentityError(
        "A cart tax line has incomplete or inconsistent quote data."
      )
    }
    return { ...code, fingerprint, rate }
  })
  const first = identities[0]
  if (!first) {
    throw new TaxQuoteIdentityError("The cart tax quote is unavailable.")
  }
  if (
    identities.some(
      (entry) =>
        entry.provider !== first.provider ||
        entry.generation !== first.generation ||
        entry.calculationId !== first.calculationId ||
        entry.fingerprint !== first.fingerprint
    )
  ) {
    throw new TaxQuoteIdentityError(
      "The cart contains tax lines from different quote generations."
    )
  }
  if (first.provider === "stripe_tax" && !first.calculationId) {
    throw new TaxQuoteIdentityError(
      "The Stripe Tax calculation identity is unavailable."
    )
  }

  const rates = new Set(identities.map((entry) => entry.rate))
  if (first.provider === "taxrate_io" && rates.size !== 1) {
    throw new TaxQuoteIdentityError(
      "The TaxRate.io quote contains inconsistent rates."
    )
  }

  return {
    calculationId: first.calculationId,
    fingerprint: first.fingerprint,
    generation: first.generation,
    provider: first.provider,
    taxRatePercent: first.provider === "taxrate_io" ? first.rate : null,
  }
}
