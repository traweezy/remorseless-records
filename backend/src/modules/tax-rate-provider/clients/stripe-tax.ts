import type Stripe from "stripe"

import { observeOperation } from "../../../lib/observability/operation-telemetry"

const MAX_LINE_ITEMS = 100
const MAX_ATTEMPTS = 2
const MAX_NETWORK_RETRIES = 0
const MAX_REQUEST_TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 200
const RETRY_DELAY_MS = 100

export type StripeTaxAddress = {
  address1?: string
  address2?: string | null
  city?: string
  countryCode: string
  postalCode?: string
  provinceCode?: string | null
}

export type StripeTaxLineInput = {
  amount: number
  quantity: number
  reference: string
  taxCode?: string
}

export type StripeTaxShippingInput = {
  amount: number
  taxCode?: string
}

export type StripeTaxCalculationResult = {
  amountTotal: number
  calculationId: string
  currency: string
  expiresAt: number | null
  itemTaxByReference: Record<string, number>
  livemode: boolean
  shippingTax: number
  taxAmountExclusive: number
}

export type StripeTaxClientErrorCode =
  | "deadline_exceeded"
  | "invalid_request"
  | "invalid_response"
  | "provider_rejected"
  | "provider_unavailable"

export type StripeTaxRetryEvent = {
  attempt: number
  operation: "create" | "list_line_items" | "retrieve"
  reason: "status" | "transport"
  totalAttempts: number
}

export class StripeTaxClientError extends Error {
  readonly code: StripeTaxClientErrorCode

  constructor(code: StripeTaxClientErrorCode) {
    super(`Stripe Tax request failed (${code}).`)
    this.name = "StripeTaxClientError"
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>
type StripeTaxClient = Pick<Stripe, "tax">
type ValidatedLineInput = Stripe.Tax.CalculationCreateParams.LineItem & {
  reference: string
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null

const asUnknownArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value.map((item: unknown) => item) : null

const fail = (code: StripeTaxClientErrorCode): never => {
  throw new StripeTaxClientError(code)
}

const clientErrorFrom = (error: unknown): StripeTaxClientError => {
  if (error instanceof StripeTaxClientError) {
    return error
  }

  const record = asRecord(error)
  const raw = asRecord(record?.raw)
  const detail = asRecord(raw?.detail)
  if (record?.code === "ETIMEDOUT" || detail?.code === "ETIMEDOUT") {
    return new StripeTaxClientError("deadline_exceeded")
  }

  const statusCode = record?.statusCode
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
    return new StripeTaxClientError(
      statusCode === 429 || statusCode >= 500
        ? "provider_unavailable"
        : "provider_rejected"
    )
  }

  return new StripeTaxClientError("provider_unavailable")
}

const retryReasonFrom = (
  error: unknown
): StripeTaxRetryEvent["reason"] | null => {
  if (error instanceof StripeTaxClientError) {
    return null
  }

  const record = asRecord(error)
  const raw = asRecord(record?.raw)
  const detail = asRecord(raw?.detail)
  const headers = asRecord(record?.headers)
  const retryHeader = headers?.["stripe-should-retry"]
  if (retryHeader === "false") {
    return null
  }

  const timedOut = record?.code === "ETIMEDOUT" || detail?.code === "ETIMEDOUT"
  if (timedOut || record?.type === "StripeConnectionError") {
    return "transport"
  }

  const statusCode = record?.statusCode
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) {
    return null
  }
  if (statusCode === 429) {
    return null
  }
  return retryHeader === "true" || statusCode === 409 || statusCode >= 500
    ? "status"
    : null
}

const safeInteger = (
  value: unknown,
  minimum: number,
  code: StripeTaxClientErrorCode
): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : fail(code)

const boundedText = (
  value: unknown,
  pattern: RegExp,
  code: StripeTaxClientErrorCode
): string => {
  if (typeof value !== "string") {
    return fail(code)
  }
  const normalized = value.trim()
  return normalized.length <= MAX_TEXT_LENGTH && pattern.test(normalized)
    ? normalized
    : fail(code)
}

const optionalText = (
  value: string | null | undefined,
  code: StripeTaxClientErrorCode
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= MAX_TEXT_LENGTH
    ? normalized
    : fail(code)
}

const taxCodeFrom = (
  value: string | undefined,
  code: StripeTaxClientErrorCode
): string | undefined =>
  value === undefined ? undefined : boundedText(value, /^txcd_\d{8}$/, code)

const timeoutFrom = (value: number): number =>
  Number.isSafeInteger(value) && value > 0 && value <= MAX_REQUEST_TIMEOUT_MS
    ? value
    : fail("invalid_request")

const requestOptions = (
  deadlineAt: number,
  idempotencyKey?: string
): Stripe.RequestOptions => {
  const remainingMs = Math.ceil(deadlineAt - Date.now())
  if (remainingMs <= 0) {
    return fail("deadline_exceeded")
  }
  return {
    ...(idempotencyKey ? { idempotencyKey } : {}),
    maxNetworkRetries: MAX_NETWORK_RETRIES,
    timeout: remainingMs,
  }
}

const waitForRetry = async (deadlineAt: number): Promise<void> => {
  if (deadlineAt - Date.now() <= RETRY_DELAY_MS) {
    return fail("deadline_exceeded")
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, RETRY_DELAY_MS)
  })
}

const requestWithRetry = async <T>({
  deadlineAt,
  idempotencyKey,
  onRetry,
  operation,
  request,
}: {
  deadlineAt: number
  idempotencyKey?: string
  onRetry?: (event: StripeTaxRetryEvent) => void
  operation: StripeTaxRetryEvent["operation"]
  request: (options: Stripe.RequestOptions) => Promise<T>
}): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await observeOperation(
        { domain: "stripe", operation: "provider_request" },
        () => request(requestOptions(deadlineAt, idempotencyKey))
      )
    } catch (error) {
      const reason = retryReasonFrom(error)
      if (attempt === MAX_ATTEMPTS || reason === null) {
        throw clientErrorFrom(error)
      }
      onRetry?.({
        attempt: attempt + 1,
        operation,
        reason,
        totalAttempts: MAX_ATTEMPTS,
      })
      await waitForRetry(deadlineAt)
    }
  }
  return fail("provider_unavailable")
}

const addressParams = (
  address: StripeTaxAddress
): Stripe.Tax.CalculationCreateParams.CustomerDetails.Address => {
  const country = boundedText(
    address.countryCode,
    /^[A-Za-z]{2}$/,
    "invalid_request"
  ).toUpperCase()
  const line1 = optionalText(address.address1, "invalid_request")
  const line2 = optionalText(address.address2, "invalid_request")
  const city = optionalText(address.city, "invalid_request")
  const postalCode = optionalText(address.postalCode, "invalid_request")
  const provinceCode = optionalText(address.provinceCode, "invalid_request")
  return {
    country,
    ...(line1 ? { line1 } : {}),
    ...(line2 ? { line2 } : {}),
    ...(city ? { city } : {}),
    ...(postalCode ? { postal_code: postalCode } : {}),
    ...(provinceCode ? { state: provinceCode.toUpperCase() } : {}),
  }
}

const lineInputsFrom = (
  itemLines: StripeTaxLineInput[]
): ValidatedLineInput[] => {
  if (itemLines.length === 0 || itemLines.length > MAX_LINE_ITEMS) {
    return fail("invalid_request")
  }

  const references = new Set<string>()
  return itemLines.map((line) => {
    const reference = boundedText(
      line.reference,
      /^[A-Za-z0-9_-]+$/,
      "invalid_request"
    )
    if (references.has(reference)) {
      return fail("invalid_request")
    }
    references.add(reference)
    const taxCode = taxCodeFrom(line.taxCode, "invalid_request")
    return {
      amount: safeInteger(line.amount, 1, "invalid_request"),
      quantity: safeInteger(line.quantity, 1, "invalid_request"),
      reference,
      tax_behavior: "exclusive",
      ...(taxCode ? { tax_code: taxCode } : {}),
    }
  })
}

const shippingParamsFrom = (
  shipping: StripeTaxShippingInput | undefined
): Stripe.Tax.CalculationCreateParams.ShippingCost | undefined => {
  if (!shipping) {
    return undefined
  }
  const taxCode = taxCodeFrom(shipping.taxCode, "invalid_request")
  return {
    amount: safeInteger(shipping.amount, 1, "invalid_request"),
    tax_behavior: "exclusive",
    ...(taxCode ? { tax_code: taxCode } : {}),
  }
}

const lineItemsFrom = (value: unknown): unknown[] => {
  const page = asRecord(value)
  const data = asUnknownArray(page?.data)
  if (!page || page.object !== "list" || page.has_more !== false || !data) {
    return fail("invalid_response")
  }
  return data
}

const readLineItems = async (
  client: StripeTaxClient,
  calculationId: string,
  lineItems: unknown,
  deadlineAt: number,
  onRetry?: (event: StripeTaxRetryEvent) => void
): Promise<unknown[]> => {
  const expanded = asRecord(lineItems)
  const expandedData = asUnknownArray(expanded?.data)
  if (
    expanded?.object === "list" &&
    expanded.has_more === false &&
    expandedData
  ) {
    return expandedData
  }
  if (expanded && expanded.has_more !== true) {
    return fail("invalid_response")
  }

  const page = await requestWithRetry({
    deadlineAt,
    ...(onRetry ? { onRetry } : {}),
    operation: "list_line_items",
    request: (options) =>
      client.tax.calculations.listLineItems(
        calculationId,
        { limit: MAX_LINE_ITEMS },
        options
      ),
  })
  return lineItemsFrom(page)
}

const itemTaxesFrom = (
  lineItems: unknown[],
  expectedReferences?: readonly string[]
): Record<string, number> => {
  if (lineItems.length === 0 || lineItems.length > MAX_LINE_ITEMS) {
    return fail("invalid_response")
  }

  const taxes: Record<string, number> = {}
  for (const value of lineItems) {
    const line = asRecord(value)
    if (line?.object !== "tax.calculation_line_item") {
      return fail("invalid_response")
    }
    const reference = boundedText(
      line?.reference,
      /^[A-Za-z0-9_-]+$/,
      "invalid_response"
    )
    if (Object.hasOwn(taxes, reference)) {
      return fail("invalid_response")
    }
    taxes[reference] = safeInteger(line?.amount_tax, 0, "invalid_response")
  }

  if (expectedReferences) {
    const expected = new Set(expectedReferences)
    if (
      expected.size !== expectedReferences.length ||
      expected.size !== Object.keys(taxes).length ||
      [...expected].some((reference) => !Object.hasOwn(taxes, reference))
    ) {
      return fail("invalid_response")
    }
  }
  return taxes
}

const serializeCalculation = async (
  client: StripeTaxClient,
  calculation: unknown,
  deadlineAt: number,
  expectedReferences?: readonly string[],
  onRetry?: (event: StripeTaxRetryEvent) => void
): Promise<StripeTaxCalculationResult> => {
  const record = asRecord(calculation)
  if (record?.object !== "tax.calculation") {
    return fail("invalid_response")
  }
  const calculationId = boundedText(
    record?.id,
    /^taxcalc_[A-Za-z0-9]+$/,
    "invalid_response"
  )
  const currency = boundedText(
    record?.currency,
    /^[A-Za-z]{3}$/,
    "invalid_response"
  ).toLowerCase()
  if (typeof record?.livemode !== "boolean") {
    return fail("invalid_response")
  }

  const amountTotal = safeInteger(record.amount_total, 0, "invalid_response")
  const taxAmountExclusive = safeInteger(
    record.tax_amount_exclusive,
    0,
    "invalid_response"
  )
  const shippingCost =
    record.shipping_cost === null || record.shipping_cost === undefined
      ? null
      : asRecord(record.shipping_cost)
  if (
    record.shipping_cost !== null &&
    record.shipping_cost !== undefined &&
    !shippingCost
  ) {
    return fail("invalid_response")
  }
  const shippingTax = shippingCost
    ? safeInteger(shippingCost.amount_tax, 0, "invalid_response")
    : 0
  const expiresAt =
    record.expires_at === null || record.expires_at === undefined
      ? null
      : safeInteger(record.expires_at, 1, "invalid_response")
  const lineItems = await readLineItems(
    client,
    calculationId,
    record.line_items,
    deadlineAt,
    onRetry
  )
  const itemTaxByReference = itemTaxesFrom(lineItems, expectedReferences)
  const itemTaxTotal = Object.values(itemTaxByReference).reduce(
    (total, tax) => total + tax,
    0
  )
  if (
    !Number.isSafeInteger(itemTaxTotal) ||
    itemTaxTotal + shippingTax !== taxAmountExclusive ||
    amountTotal < taxAmountExclusive
  ) {
    return fail("invalid_response")
  }

  return {
    amountTotal,
    calculationId,
    currency,
    expiresAt,
    itemTaxByReference,
    livemode: record.livemode,
    shippingTax,
    taxAmountExclusive,
  }
}

export const createStripeTaxCalculation = async ({
  address,
  client,
  currency,
  idempotencyKey,
  itemLines,
  onRetry,
  shipping,
  timeoutMs,
}: {
  address: StripeTaxAddress
  client: StripeTaxClient
  currency: string
  idempotencyKey: string
  itemLines: StripeTaxLineInput[]
  onRetry?: (event: StripeTaxRetryEvent) => void
  shipping?: StripeTaxShippingInput
  timeoutMs: number
}): Promise<StripeTaxCalculationResult> => {
  try {
    const deadlineAt = Date.now() + timeoutFrom(timeoutMs)
    const lineItems = lineInputsFrom(itemLines)
    const normalizedCurrency = boundedText(
      currency,
      /^[A-Za-z]{3}$/,
      "invalid_request"
    ).toLowerCase()
    const normalizedIdempotencyKey = boundedText(
      idempotencyKey,
      /^[A-Za-z0-9:_-]+$/,
      "invalid_request"
    )
    const shippingCost = shippingParamsFrom(shipping)
    const calculation = await requestWithRetry({
      deadlineAt,
      idempotencyKey: normalizedIdempotencyKey,
      ...(onRetry ? { onRetry } : {}),
      operation: "create",
      request: (options) =>
        client.tax.calculations.create(
          {
            currency: normalizedCurrency,
            customer_details: {
              address: addressParams(address),
              address_source: "shipping",
            },
            expand: ["line_items"],
            line_items: lineItems,
            ...(shippingCost ? { shipping_cost: shippingCost } : {}),
          },
          options
        ),
    })

    return await serializeCalculation(
      client,
      calculation,
      deadlineAt,
      lineItems.map((line) => line.reference),
      onRetry
    )
  } catch (error) {
    throw clientErrorFrom(error)
  }
}

export const retrieveStripeTaxCalculation = async ({
  calculationId,
  client,
  expectedReferences,
  onRetry,
  timeoutMs,
}: {
  calculationId: string
  client: StripeTaxClient
  expectedReferences: readonly string[]
  onRetry?: (event: StripeTaxRetryEvent) => void
  timeoutMs: number
}): Promise<StripeTaxCalculationResult> => {
  try {
    const deadlineAt = Date.now() + timeoutFrom(timeoutMs)
    const normalizedId = boundedText(
      calculationId,
      /^taxcalc_[A-Za-z0-9]+$/,
      "invalid_request"
    )
    const calculation = await requestWithRetry({
      deadlineAt,
      ...(onRetry ? { onRetry } : {}),
      operation: "retrieve",
      request: (options) =>
        client.tax.calculations.retrieve(
          normalizedId,
          { expand: ["line_items"] },
          options
        ),
    })
    return await serializeCalculation(
      client,
      calculation,
      deadlineAt,
      expectedReferences,
      onRetry
    )
  } catch (error) {
    throw clientErrorFrom(error)
  }
}
