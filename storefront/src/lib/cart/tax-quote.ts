import {
  asUnknownRecord,
  readBoundedText,
  readFiniteNumber,
  readPositiveSafeInteger,
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary"

export type TaxProviderName = "stripe_tax" | "taxrate_io"
export type TaxCollectionMode = "collect" | "disabled"

export type TaxQuoteIdentity = {
  calculationId: string | null
  collectionMode: TaxCollectionMode
  fingerprint: string
  generation: number
  provider: TaxProviderName | null
  taxRatePercent: number | null
}

export class TaxQuoteIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TaxQuoteIdentityError"
  }
}

const text = (value: unknown): string => readBoundedText(value, 255) ?? ""

const recordsFrom = (
  value: unknown,
  context: string,
  optional = false
): UnknownRecord[] => {
  const records = readRecordArray(value, { optional })
  if (!records) {
    throw new TaxQuoteIdentityError(`${context} is malformed.`)
  }
  return records
}

const parseCode = (
  value: unknown
): Omit<TaxQuoteIdentity, "fingerprint" | "taxRatePercent"> | null => {
  if (typeof value !== "string") {
    return null
  }

  const [prefix, identity, generationValue, calculationValue, ...rest] =
    value.split(":")
  const generation = readPositiveSafeInteger(generationValue?.slice(1))
  const collectionMode: TaxCollectionMode =
    identity === "disabled" ? "disabled" : "collect"
  const provider: TaxProviderName | null =
    identity === "stripe_tax" || identity === "taxrate_io" ? identity : null
  if (
    rest.length ||
    prefix !== "rr_tax" ||
    (collectionMode === "collect" && provider === null) ||
    (provider === "taxrate_io" && calculationValue !== "quote") ||
    (provider === "stripe_tax" &&
      !/^taxcalc_[A-Za-z0-9]+$/.test(calculationValue ?? "")) ||
    (collectionMode === "disabled" && calculationValue !== "decision") ||
    !generationValue?.startsWith("g") ||
    generation === null
  ) {
    return null
  }

  const calculationId =
    provider === "stripe_tax" && calculationValue ? calculationValue : null

  return { calculationId, collectionMode, generation, provider }
}

const taxSubjectsFrom = (cart: UnknownRecord): UnknownRecord[] => [
  ...recordsFrom(cart.items, "The cart item tax projection", true),
  ...recordsFrom(
    cart.shipping_methods,
    "The cart shipping tax projection",
    true
  ),
]

export const taxQuoteIdentityFromCart = (value: unknown): TaxQuoteIdentity => {
  const cart = asUnknownRecord(value)
  if (!cart) {
    throw new TaxQuoteIdentityError("The cart tax snapshot is unavailable.")
  }

  const subjects = taxSubjectsFrom(cart)
  if (!subjects.length) {
    throw new TaxQuoteIdentityError("The cart has no taxable subjects.")
  }

  const lines = subjects.flatMap((subject) => {
    const taxLines = recordsFrom(
      subject.tax_lines,
      "A cart subject tax-line projection"
    )
    if (!taxLines.length) {
      throw new TaxQuoteIdentityError(
        "Every cart item and shipping method must have a tax quote."
      )
    }
    return taxLines
  })

  const identities = lines.map((line) => {
    const code = parseCode(line.code)
    const data = asUnknownRecord(line.data)
    const collectionMode = text(data?.collection_mode) || "collect"
    const fingerprint = text(data?.fingerprint)
    const generation = readPositiveSafeInteger(data?.generation)
    const provider = text(data?.provider)
    const calculationId = text(data?.calculation_id) || null
    const rate = readFiniteNumber(line.rate)
    if (
      !code ||
      collectionMode !== code.collectionMode ||
      (code.collectionMode === "collect" && provider !== code.provider) ||
      (code.collectionMode === "disabled" && provider !== "") ||
      generation === null ||
      generation !== code.generation ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(fingerprint) ||
      calculationId !== code.calculationId ||
      rate === null ||
      rate < 0 ||
      rate > 100 ||
      (code.collectionMode === "disabled" && rate !== 0)
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
        entry.collectionMode !== first.collectionMode ||
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
  if (
    first.collectionMode === "collect" &&
    first.provider === "stripe_tax" &&
    !first.calculationId
  ) {
    throw new TaxQuoteIdentityError(
      "The Stripe Tax calculation identity is unavailable."
    )
  }

  const rates = new Set(identities.map((entry) => entry.rate))
  if (
    first.collectionMode === "collect" &&
    first.provider === "taxrate_io" &&
    rates.size !== 1
  ) {
    throw new TaxQuoteIdentityError(
      "The TaxRate.io quote contains inconsistent rates."
    )
  }

  return {
    calculationId: first.calculationId,
    collectionMode: first.collectionMode,
    fingerprint: first.fingerprint,
    generation: first.generation,
    provider: first.provider,
    taxRatePercent:
      first.collectionMode === "collect" && first.provider === "taxrate_io"
        ? first.rate
        : null,
  }
}
