import {
  readFiniteNumber,
  readNonNegativeSafeInteger,
} from "../../../lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  type UnknownRecord,
} from "../../../lib/provider-boundary/records"

export type TaxRateIoErrorCode =
  | "deadline_exceeded"
  | "invalid_response"
  | "provider_rejected"
  | "provider_unavailable"

export type TaxRateIoRetryEvent = {
  attempt: number
  reason: "status" | "transport"
  totalAttempts: number
}

export class TaxRateIoClientError extends Error {
  readonly code: TaxRateIoErrorCode

  constructor(code: TaxRateIoErrorCode) {
    super(`Tax rate lookup failed (${code})`)
    this.code = code
    this.name = "TaxRateIoClientError"
  }
}

export type TaxRateIoQuota = {
  observedAt: string
  quota: number
  remaining: number
  usage: number
  usagePercent: number
}

export type TaxRateIoResult = {
  jurisdiction: TaxRateIoJurisdiction | null
  quota: TaxRateIoQuota | null
  ratePercent: number
}

export type TaxRateIoJurisdiction = {
  city: string | null
  country_code: string | null
  county: string | null
  level: "city" | "county" | "state" | null
  name: string | null
  rate_components: {
    city: number | null
    county: number | null
    special: number | null
    state: number | null
  }
  state: string | null
  tax_name: string | null
}

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 100
const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504])

const normalizedText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() && value.trim().length <= 200
    ? value.trim()
    : null

const componentRate = (value: unknown): number | null => {
  const parsed = readFiniteNumber(value)
  if (parsed === null) {
    return null
  }

  return parsed < 0 || parsed > 100 ? null : Number(parsed.toFixed(12))
}

const parseJurisdiction = (
  value: UnknownRecord
): TaxRateIoJurisdiction | null => {
  const city = normalizedText(value.city)
  const county = normalizedText(value.county)
  const state = normalizedText(value.state)?.toUpperCase() ?? null
  const country = normalizedText(value.country)?.toUpperCase() ?? null
  const taxName = normalizedText(value.tax_name)
  const components = {
    city: componentRate(value.rate_city),
    county: componentRate(value.rate_county),
    special: componentRate(value.rate_special),
    state: componentRate(value.rate_state),
  }
  if (
    !city &&
    !county &&
    !state &&
    !country &&
    !taxName &&
    Object.values(components).every((rate) => rate === null)
  ) {
    return null
  }

  return {
    city,
    country_code: country,
    county,
    level: county ? "county" : city ? "city" : state ? "state" : null,
    name: county ?? city ?? state,
    rate_components: components,
    state,
    tax_name: taxName,
  }
}

const parseQuota = (value: unknown): TaxRateIoQuota | null => {
  const record = asUnknownRecord(value)
  if (!record) {
    return null
  }

  const usage = readNonNegativeSafeInteger(record.usage)
  const quota = readNonNegativeSafeInteger(record.quota)
  const reportedPercent = readFiniteNumber(record.usage_pct)
  if (
    usage === null ||
    quota === null ||
    quota === 0 ||
    usage > quota ||
    (reportedPercent !== null && (reportedPercent < 0 || reportedPercent > 100))
  ) {
    return null
  }

  const usagePercent =
    reportedPercent !== null && reportedPercent >= 0
      ? reportedPercent
      : (usage / quota) * 100

  return {
    observedAt: new Date().toISOString(),
    quota,
    remaining: Math.max(0, quota - usage),
    usage,
    usagePercent,
  }
}

const parseRatePercent = (value: UnknownRecord): number | null => {
  const hasRate = Object.hasOwn(value, "rate")
  const hasFraction = Object.hasOwn(value, "rate_pct")
  if (!hasRate && !hasFraction) {
    return null
  }

  const directRate = hasRate ? readFiniteNumber(value.rate) : null
  const fractionalRate = hasFraction ? readFiniteNumber(value.rate_pct) : null
  if (
    (hasRate && directRate === null) ||
    (hasFraction && fractionalRate === null) ||
    (directRate !== null && (directRate < 0 || directRate > 100)) ||
    (fractionalRate !== null && (fractionalRate < 0 || fractionalRate > 1))
  ) {
    return null
  }

  const fractionPercent = fractionalRate === null ? null : fractionalRate * 100
  if (
    directRate !== null &&
    fractionPercent !== null &&
    Math.abs(directRate - fractionPercent) > 1e-9
  ) {
    return null
  }
  const ratePercent = directRate ?? fractionPercent
  return ratePercent === null ? null : Number(ratePercent.toFixed(12))
}

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel()
  } catch {
    // The response is already unusable; cancellation is best-effort cleanup.
  }
}

const waitForRetry = async (signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new TaxRateIoClientError("deadline_exceeded"))
      return
    }

    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new TaxRateIoClientError("deadline_exceeded"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, RETRY_DELAY_MS)
    signal.addEventListener("abort", onAbort, { once: true })
  })

const parseResponse = async (
  response: Response,
  signal: AbortSignal
): Promise<TaxRateIoResult> => {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new TaxRateIoClientError(
      signal.aborted ? "deadline_exceeded" : "invalid_response"
    )
  }

  const payload = asUnknownRecord(value)
  if (!payload) {
    throw new TaxRateIoClientError("invalid_response")
  }

  const ratePercent = parseRatePercent(payload)
  if (ratePercent === null) {
    throw new TaxRateIoClientError("invalid_response")
  }

  return {
    jurisdiction: parseJurisdiction(payload),
    quota: parseQuota(payload.usage_data),
    ratePercent,
  }
}

export const fetchTaxRateIo = async ({
  apiKey,
  onRetry,
  zip,
  timeoutMs,
}: {
  apiKey: string
  onRetry?: (event: TaxRateIoRetryEvent) => void
  zip: string
  timeoutMs: number
}): Promise<TaxRateIoResult> => {
  const url = new URL("https://www.taxrate.io/api/v1/rate/getratebyzip")
  url.searchParams.set("api_key", apiKey)
  url.searchParams.set("zip", zip)
  const signal = AbortSignal.timeout(timeoutMs)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        signal,
      })
    } catch {
      if (signal.aborted) {
        throw new TaxRateIoClientError("deadline_exceeded")
      }
      if (attempt === MAX_ATTEMPTS) {
        throw new TaxRateIoClientError("provider_unavailable")
      }
      onRetry?.({
        attempt: attempt + 1,
        reason: "transport",
        totalAttempts: MAX_ATTEMPTS,
      })
      await waitForRetry(signal)
      continue
    }

    if (!response.ok) {
      const retryable = RETRYABLE_STATUSES.has(response.status)
      await cancelResponseBody(response)
      if (retryable && attempt < MAX_ATTEMPTS) {
        onRetry?.({
          attempt: attempt + 1,
          reason: "status",
          totalAttempts: MAX_ATTEMPTS,
        })
        await waitForRetry(signal)
        continue
      }
      throw new TaxRateIoClientError(
        retryable ? "provider_unavailable" : "provider_rejected"
      )
    }

    return parseResponse(response, signal)
  }

  throw new TaxRateIoClientError("provider_unavailable")
}
