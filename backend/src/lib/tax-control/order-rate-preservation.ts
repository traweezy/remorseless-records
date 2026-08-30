import { parseTaxLineCode, type FrozenTaxQuote } from "./context"

type UnknownRecord = Record<string, unknown>

export type PreservedOrderRates = {
  itemRates: Record<string, number>
  shippingRates: Record<string, number>
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const ratesFor = (
  value: unknown,
  identity: FrozenTaxQuote
): Array<[string, number]> | null => {
  const entities = Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((entity): entity is UnknownRecord => entity !== null)
    : []
  const entries: Array<[string, number]> = []
  for (const entity of entities) {
    const id = text(entity.id)
    const lines = Array.isArray(entity.tax_lines)
      ? entity.tax_lines
          .map(asRecord)
          .filter((line): line is UnknownRecord => line !== null)
      : []
    if (!id || !lines.length) {
      return null
    }
    const rates = lines.map((line) => {
      const parsed = parseTaxLineCode(line.code)
      const rate = finiteNonNegative(line.rate)
      return parsed &&
        parsed.provider === identity.provider &&
        parsed.generation === identity.generation &&
        parsed.calculationId === (identity.stripeCalculationId ?? null) &&
        rate !== null
        ? rate
        : null
    })
    const validRates = rates.filter((rate): rate is number => rate !== null)
    if (validRates.length !== rates.length) {
      return null
    }
    entries.push([id, validRates.reduce((total, rate) => total + rate, 0)])
  }
  return entries
}

export const preservedRatesFromTaxLines = (
  orderOrTarget: UnknownRecord,
  identity: FrozenTaxQuote
): PreservedOrderRates | null => {
  const itemEntries = ratesFor(orderOrTarget.items, identity)
  const shippingEntries = ratesFor(orderOrTarget.shipping_methods, identity)
  if (
    itemEntries === null ||
    shippingEntries === null ||
    itemEntries.length + shippingEntries.length === 0
  ) {
    return null
  }
  return {
    itemRates: Object.fromEntries(itemEntries),
    shippingRates: Object.fromEntries(shippingEntries),
  }
}

export const preservedRateForNewShipping = (
  order: UnknownRecord,
  target: UnknownRecord,
  identity: FrozenTaxQuote
): Record<string, number> | null => {
  const targetItems = Array.isArray(target.items) ? target.items : []
  const targetShipping = Array.isArray(target.shipping_methods)
    ? target.shipping_methods
        .map(asRecord)
        .filter((method): method is UnknownRecord => method !== null)
    : []
  if (targetItems.length || !targetShipping.length) {
    return null
  }
  const targetIds = targetShipping
    .map((method) => text(method.id))
    .filter((id): id is string => id !== null)
  if (
    targetIds.length !== targetShipping.length ||
    targetShipping.some(
      (method) => Array.isArray(method.tax_lines) && method.tax_lines.length > 0
    )
  ) {
    return null
  }

  const existingShipping = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
        .map(asRecord)
        .filter(
          (method): method is UnknownRecord =>
            method !== null &&
            Array.isArray(method.tax_lines) &&
            method.tax_lines.length > 0
        )
    : []
  const existing = preservedRatesFromTaxLines(
    { items: [], shipping_methods: existingShipping },
    identity
  )
  const rates = existing ? Object.values(existing.shippingRates) : []
  if (!rates.length || rates.some((rate) => rate !== rates[0])) {
    return null
  }

  const rate = rates[0]
  return rate === undefined
    ? null
    : Object.fromEntries(targetIds.map((id) => [id, rate]))
}

export const requirePreservedStripeOrderRates = (
  order: UnknownRecord,
  target: UnknownRecord,
  identity: FrozenTaxQuote
): PreservedOrderRates => {
  const exact = preservedRatesFromTaxLines(target, identity)
  if (exact) {
    return exact
  }

  const newShipping = preservedRateForNewShipping(order, target, identity)
  if (newShipping) {
    return {
      itemRates: {},
      shippingRates: newShipping,
    }
  }

  throw new Error(
    "Stripe Tax order changes cannot add or reprice taxable items. Create a new order so its payment and tax calculation remain bound."
  )
}
