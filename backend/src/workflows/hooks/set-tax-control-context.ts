import {
  updateOrderTaxLinesWorkflow,
  updateTaxLinesWorkflow,
  upsertTaxLinesWorkflow,
} from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import {
  parseTaxLineCode,
  TAX_CONTEXT_KEY,
  type FrozenTaxQuote,
} from "../../lib/tax-control/context"
import { requirePreservedStripeOrderRates } from "../../lib/tax-control/order-rate-preservation"
import { createTaxSubjectFingerprint } from "../../lib/tax-control/subject-fingerprint"
import type CatalogModuleService from "../../modules/catalog/service"
import type {
  TaxCollectionMode,
  TaxProviderName,
} from "../../modules/tax-control/constants"
import type TaxControlModuleService from "../../modules/tax-control/service"

type UnknownRecord = Record<string, unknown>

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
    pagination?: { take?: number }
  }) => Promise<{ data: UnknownRecord[] }>
}

const PROCESSABLE_PAYMENT_STATUSES = new Set([
  "authorized",
  "captured",
  "pending",
  "pending_authorization",
  "requires_more",
])

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const adjustmentsFrom = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map(asRecord)
    .filter((adjustment): adjustment is UnknownRecord => adjustment !== null)

const taxRateDecimalFrom = (value: unknown) =>
  MathBN.div(
    MathBN.sum(
      ...(Array.isArray(value) ? value : [])
        .map(asRecord)
        .filter((line): line is UnknownRecord => line !== null)
        .map((line) => Number(line.rate ?? 0))
    ),
    100
  )

const adjustedAmountMinor = ({
  amount,
  adjustments,
  quantity = 1,
  taxLines,
}: {
  adjustments: unknown
  amount: unknown
  quantity?: unknown
  taxLines: unknown
}): number => {
  const parsedQuantity = Number(quantity)
  const parsedAmount = Number(amount)
  if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) {
    throw new Error("Tax calculation received an invalid quantity.")
  }
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    throw new Error("Tax calculation received an invalid amount.")
  }
  const gross = MathBN.mult(parsedAmount, parsedQuantity)
  const normalizedAdjustments = adjustmentsFrom(adjustments).map(
    (adjustment) => {
      const adjustmentAmount = Number(adjustment.amount)
      if (!Number.isFinite(adjustmentAmount) || adjustmentAmount < 0) {
        throw new Error("Tax calculation received an invalid adjustment.")
      }
      return {
        amount: adjustmentAmount,
        is_tax_inclusive: adjustment.is_tax_inclusive === true,
      }
    }
  )
  const taxRate = taxRateDecimalFrom(taxLines)
  const adjustmentsSubtotal = normalizedAdjustments.length
    ? MathBN.sum(
        ...normalizedAdjustments.map((adjustment) =>
          adjustment.is_tax_inclusive
            ? MathBN.div(adjustment.amount, MathBN.add(1, taxRate))
            : MathBN.convert(adjustment.amount)
        )
      )
    : MathBN.convert(0)
  const net = MathBN.sub(gross, adjustmentsSubtotal)
  const rounded = Math.round(MathBN.mult(net, 100).toNumber())
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new Error("Tax calculation received an invalid adjusted amount.")
  }
  return rounded
}

const enrichCartForTax = async (
  container: MedusaContainer,
  cart: UnknownRecord
): Promise<UnknownRecord> => {
  const cartId = text(cart.id)
  if (!cartId) {
    return cart
  }

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "items.id",
      "items.product_id",
      "items.product_type_id",
      "items.quantity",
      "items.unit_price",
      "items.tax_lines.rate",
      "items.adjustments.amount",
      "items.adjustments.is_tax_inclusive",
      "shipping_methods.id",
      "shipping_methods.shipping_option_id",
      "shipping_methods.amount",
      "shipping_methods.tax_lines.rate",
      "shipping_methods.adjustments.amount",
      "shipping_methods.adjustments.is_tax_inclusive",
      "shipping_address.address_1",
      "shipping_address.address_2",
      "shipping_address.city",
      "shipping_address.postal_code",
      "shipping_address.country_code",
      "shipping_address.province",
    ],
    filters: { id: cartId },
    pagination: { take: 1 },
  })
  return data[0] ?? cart
}

const taxableAmountsFrom = (cart: UnknownRecord) => {
  const items = Array.isArray(cart.items)
    ? cart.items
        .map(asRecord)
        .filter((item): item is UnknownRecord => item !== null)
    : []
  const shippingMethods = Array.isArray(cart.shipping_methods)
    ? cart.shipping_methods
        .map(asRecord)
        .filter((method): method is UnknownRecord => method !== null)
    : []

  return {
    itemAmountsMinor: Object.fromEntries(
      items.flatMap((item) => {
        const id = text(item.id)
        return id
          ? [
              [
                id,
                adjustedAmountMinor({
                  adjustments: item.adjustments,
                  amount: item.unit_price,
                  quantity: item.quantity,
                  taxLines: item.tax_lines,
                }),
              ],
            ]
          : []
      })
    ),
    shippingAmountMinor: shippingMethods.reduce(
      (total, method) =>
        total +
        adjustedAmountMinor({
          adjustments: method.adjustments,
          amount: method.amount,
          taxLines: method.tax_lines,
        }),
      0
    ),
  }
}

const resolveItemTaxCodes = async (
  container: MedusaContainer,
  orderOrCart: UnknownRecord
): Promise<Record<string, string>> => {
  const items = Array.isArray(orderOrCart.items)
    ? orderOrCart.items
        .map(asRecord)
        .filter((item): item is UnknownRecord => item !== null)
    : []
  const productIds = Array.from(
    new Set(
      items
        .map((item) => text(item.product_id))
        .filter((value): value is string => value !== null)
    )
  )
  if (!productIds.length) {
    return {}
  }

  const catalog = container.resolve<CatalogModuleService>("catalog")
  const profiles = await catalog.listCatalogProductProfiles(
    { product_id: productIds },
    { select: ["product_id", "metadata"], take: productIds.length }
  )
  const codeByProductId = new Map<string, string>()
  for (const profile of profiles) {
    const metadata = asRecord(profile.metadata)
    const taxCode = text(metadata?.stripe_tax_code)
    if (taxCode && /^txcd_\d{8}$/.test(taxCode)) {
      codeByProductId.set(profile.product_id, taxCode)
    }
  }

  return Object.fromEntries(
    items.flatMap((item) => {
      const itemId = text(item.id)
      const productId = text(item.product_id)
      const code = productId ? codeByProductId.get(productId) : undefined
      return itemId && code ? [[itemId, code]] : []
    })
  )
}

const frozenQuoteFromMetadata = (
  metadata: UnknownRecord,
  orderOrCart: UnknownRecord
): {
  fingerprint: string
  quote: FrozenTaxQuote
} | null => {
  const provider = text(metadata.rr_tax_provider)
  const collectionModeValue = text(metadata.rr_tax_collection_mode)
  const collectionMode: TaxCollectionMode | null =
    collectionModeValue === "disabled"
      ? "disabled"
      : collectionModeValue === "collect" ||
          provider === "taxrate_io" ||
          provider === "stripe_tax"
        ? "collect"
        : null
  const generation = positiveInteger(metadata.rr_tax_generation)
  const fingerprint = text(metadata.rr_tax_fingerprint)
  if (
    !collectionMode ||
    (collectionMode === "collect" &&
      provider !== "taxrate_io" &&
      provider !== "stripe_tax") ||
    (collectionMode === "disabled" && provider !== null) ||
    !generation ||
    !fingerprint
  ) {
    return null
  }

  const currentFingerprint = createTaxSubjectFingerprint({
    collectionMode,
    generation,
    orderOrCart,
    provider:
      provider === "taxrate_io" || provider === "stripe_tax" ? provider : null,
  })
  if (currentFingerprint !== fingerprint) {
    return null
  }

  const calculationId = text(metadata.rr_tax_calculation_id)
  const rate = finiteNonNegative(metadata.rr_tax_rate_percent)
  if (
    collectionMode === "collect" &&
    provider === "stripe_tax" &&
    (!calculationId || !/^taxcalc_[A-Za-z0-9]+$/.test(calculationId))
  ) {
    return null
  }
  if (
    (collectionMode === "collect" &&
      provider === "taxrate_io" &&
      rate === null) ||
    (collectionMode === "disabled" && (calculationId !== null || rate !== null))
  ) {
    return null
  }

  return {
    fingerprint,
    quote: {
      collectionMode,
      generation,
      provider:
        provider === "taxrate_io" || provider === "stripe_tax"
          ? provider
          : null,
      ...(calculationId ? { stripeCalculationId: calculationId } : {}),
      ...(rate !== null ? { taxRatePercent: rate } : {}),
    },
  }
}

const resolveFrozenCartQuote = async (
  container: MedusaContainer,
  cart: UnknownRecord
): Promise<ReturnType<typeof frozenQuoteFromMetadata>> => {
  const cartId = text(cart.id)
  if (!cartId) {
    return null
  }

  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
    ],
    filters: { id: cartId },
    pagination: { take: 1 },
  })
  const resolvedCart = data[0]
  const collection = asRecord(resolvedCart?.payment_collection)
  const sessions = Array.isArray(collection?.payment_sessions)
    ? collection.payment_sessions
    : []

  for (const value of sessions) {
    const session = asRecord(value)
    if (
      text(session?.provider_id) !== "pp_stripe_stripe" ||
      !PROCESSABLE_PAYMENT_STATUSES.has(text(session?.status) ?? "")
    ) {
      continue
    }

    const dataRecord = asRecord(session?.data)
    const metadata = asRecord(dataRecord?.metadata)
    if (!metadata) {
      continue
    }
    const frozen = frozenQuoteFromMetadata(metadata, cart)
    if (frozen) {
      return frozen
    }
  }

  return null
}

const identityFromTaxLines = (
  orderOrCart: UnknownRecord
): FrozenTaxQuote | null => {
  const items = Array.isArray(orderOrCart.items) ? orderOrCart.items : []
  const shippingMethods = Array.isArray(orderOrCart.shipping_methods)
    ? orderOrCart.shipping_methods
    : []
  const taxLines = [...items, ...shippingMethods].flatMap((value) => {
    const record = asRecord(value)
    return Array.isArray(record?.tax_lines) ? record.tax_lines : []
  })
  const identities = taxLines
    .map(asRecord)
    .map((line) => parseTaxLineCode(line?.code))
    .filter((value): value is NonNullable<typeof value> => value !== null)
  const first = identities[0]
  if (
    !first ||
    identities.some(
      (identity) =>
        identity.provider !== first.provider ||
        identity.collectionMode !== first.collectionMode ||
        identity.generation !== first.generation ||
        identity.calculationId !== first.calculationId
    )
  ) {
    return null
  }

  const rates = taxLines
    .map(asRecord)
    .map((line) => finiteNonNegative(line?.rate))
    .filter((rate): rate is number => rate !== null)
  const firstRate = rates[0]

  return {
    collectionMode: first.collectionMode,
    generation: first.generation,
    provider: first.provider,
    ...(first.calculationId
      ? { stripeCalculationId: first.calculationId }
      : {}),
    ...(first.collectionMode === "collect" &&
    first.provider === "taxrate_io" &&
    firstRate !== undefined
      ? { taxRatePercent: firstRate }
      : {}),
  }
}

const ensureControl = async (
  container: MedusaContainer
): Promise<{
  active_provider: TaxProviderName
  collection_mode: TaxCollectionMode
  generation: number
}> => {
  const service = container.resolve<TaxControlModuleService>("tax_control")
  return service.ensureTaxProviderControl()
}

const contextForCart = async (
  container: MedusaContainer,
  cart: UnknownRecord
) => {
  const subjectId = text(cart.id)
  if (!subjectId) {
    throw new Error("Tax calculation cart identity is unavailable.")
  }
  const taxCart = await enrichCartForTax(container, cart)
  const [control, frozen, itemTaxCodes] = await Promise.all([
    ensureControl(container),
    resolveFrozenCartQuote(container, taxCart),
    resolveItemTaxCodes(container, taxCart),
  ])
  const taxableAmounts = taxableAmountsFrom(taxCart)
  const collectionMode = frozen?.quote.collectionMode ?? control.collection_mode
  const provider =
    collectionMode === "collect"
      ? (frozen?.quote.provider ?? control.active_provider)
      : null
  const generation = frozen?.quote.generation ?? control.generation
  const fingerprint =
    frozen?.fingerprint ??
    createTaxSubjectFingerprint({
      collectionMode,
      generation,
      orderOrCart: taxCart,
      provider,
    })

  return {
    [TAX_CONTEXT_KEY]: {
      fingerprint,
      collectionMode,
      ...(frozen ? { frozenQuote: frozen.quote } : {}),
      generation,
      ...taxableAmounts,
      itemTaxCodes,
      provider,
      subjectId,
    },
  }
}

const contextForOrder = async (
  container: MedusaContainer,
  order: UnknownRecord,
  items?: unknown,
  shippingMethods?: unknown
) => {
  const subjectId = text(order.id)
  if (!subjectId) {
    throw new Error("Tax calculation order identity is unavailable.")
  }
  const isPartialUpdate = Array.isArray(items) || Array.isArray(shippingMethods)
  const taxSubject = {
    ...order,
    ...(isPartialUpdate
      ? {
          items: Array.isArray(items) ? items : [],
          shipping_methods: Array.isArray(shippingMethods)
            ? shippingMethods
            : [],
        }
      : {}),
  }
  const [control, itemTaxCodes] = await Promise.all([
    ensureControl(container),
    resolveItemTaxCodes(container, taxSubject),
  ])
  const historical =
    identityFromTaxLines(taxSubject) ?? identityFromTaxLines(order)
  const collectionMode = historical?.collectionMode ?? control.collection_mode
  const provider =
    collectionMode === "collect"
      ? (historical?.provider ?? control.active_provider)
      : null
  const generation = historical?.generation ?? control.generation
  const preservedRates =
    historical?.collectionMode === "collect" &&
    historical.provider === "stripe_tax"
      ? requirePreservedStripeOrderRates(order, taxSubject, historical)
      : null
  const frozenQuote =
    historical?.collectionMode === "disabled" ||
    (historical?.collectionMode === "collect" &&
      historical.provider === "taxrate_io") ||
    preservedRates
      ? historical
      : null
  const fingerprint = createTaxSubjectFingerprint({
    collectionMode,
    generation,
    orderOrCart: taxSubject,
    provider,
  })
  const taxableAmounts = taxableAmountsFrom(taxSubject)

  return {
    [TAX_CONTEXT_KEY]: {
      fingerprint,
      collectionMode,
      ...(frozenQuote ? { frozenQuote } : {}),
      generation,
      ...taxableAmounts,
      itemTaxCodes,
      ...(preservedRates
        ? {
            preservedItemRates: preservedRates.itemRates,
            preservedShippingRates: preservedRates.shippingRates,
          }
        : {}),
      provider,
      subjectId,
    },
  }
}

updateTaxLinesWorkflow.hooks.setTaxLineContext(
  async ({ cart }, { container }) =>
    new StepResponse(await contextForCart(container, cart as UnknownRecord))
)

upsertTaxLinesWorkflow.hooks.setTaxLineContext(
  async ({ cart }, { container }) =>
    new StepResponse(await contextForCart(container, cart as UnknownRecord))
)

updateOrderTaxLinesWorkflow.hooks.setTaxLineContext(
  async ({ items, order, shipping_methods }, { container }) =>
    new StepResponse(
      await contextForOrder(
        container,
        order as UnknownRecord,
        items,
        shipping_methods
      )
    )
)
