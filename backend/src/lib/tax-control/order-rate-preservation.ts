import { parseTaxLineCode, type FrozenTaxQuote } from "./context"

import { readFiniteNumber } from "../provider-boundary/primitives"
import {
  readRecordArray,
  type UnknownRecord,
} from "../provider-boundary/records"

export type PreservedOrderRates = {
  itemRates: Record<string, number>
  shippingRates: Record<string, number>
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = readFiniteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

const ratesFor = (
  value: unknown,
  identity: FrozenTaxQuote
): Array<[string, number]> | null => {
  const entities = readRecordArray(value, {
    context: "Preserved tax-rate entity query",
    optional: true,
  })
  const entries: Array<[string, number]> = []
  const entityIds = new Set<string>()
  for (const entity of entities) {
    const id = text(entity.id)
    const lines = readRecordArray(entity.tax_lines, {
      context: "Preserved tax-rate line query",
      optional: true,
    })
    if (!id || entityIds.has(id) || !lines.length) {
      return null
    }
    entityIds.add(id)
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
  const targetItems = readRecordArray(target.items, {
    context: "Preserved tax-rate target item query",
    optional: true,
  })
  const targetShipping = readRecordArray(target.shipping_methods, {
    context: "Preserved tax-rate target shipping query",
    optional: true,
  })
  if (targetItems.length || !targetShipping.length) {
    return null
  }
  const targetIds = targetShipping
    .map((method) => text(method.id))
    .filter((id): id is string => id !== null)
  if (
    targetIds.length !== targetShipping.length ||
    new Set(targetIds).size !== targetIds.length ||
    targetShipping.some(
      (method) => Array.isArray(method.tax_lines) && method.tax_lines.length > 0
    )
  ) {
    return null
  }

  const existingShipping = readRecordArray(order.shipping_methods, {
    context: "Preserved tax-rate source shipping query",
    optional: true,
  }).filter(
    (method) => Array.isArray(method.tax_lines) && method.tax_lines.length > 0
  )
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
