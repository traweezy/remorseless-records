type TaxRateIoResponse = {
  city?: unknown
  country?: unknown
  county?: unknown
  rate?: unknown
  rate_city?: unknown
  rate_county?: unknown
  rate_pct?: unknown
  rate_special?: unknown
  rate_state?: unknown
  state?: unknown
  tax_name?: unknown
  usage_data?: unknown
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseRateValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim()
    if (!normalized) {
      return null
    }
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const normalizeRatePercent = (rawRate: number): number => {
  if (rawRate <= 1) {
    return rawRate * 100
  }

  return rawRate
}

const normalizedText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const componentRate = (value: unknown): number | null => {
  const parsed = parseRateValue(value)
  if (parsed === null) {
    return null
  }

  const normalized = normalizeRatePercent(parsed)
  return normalized < 0 || normalized > 100
    ? null
    : Number(normalized.toFixed(12))
}

const parseJurisdiction = (
  value: TaxRateIoResponse
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

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = parseRateValue(value)
  if (parsed === null || parsed < 0 || !Number.isInteger(parsed)) {
    return null
  }

  return parsed
}

const parseQuota = (
  value: TaxRateIoResponse["usage_data"]
): TaxRateIoQuota | null => {
  if (!isRecord(value)) {
    return null
  }

  const usage = nonNegativeInteger(value.usage)
  const quota = nonNegativeInteger(value.quota)
  const reportedPercent = parseRateValue(value.usage_pct)
  if (usage === null || quota === null || quota === 0) {
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

  if (!isRecord(value)) {
    throw new TaxRateIoClientError("invalid_response")
  }

  const payload = value as TaxRateIoResponse
  const rawRate = parseRateValue(payload.rate ?? payload.rate_pct)
  if (rawRate === null) {
    throw new TaxRateIoClientError("invalid_response")
  }

  const ratePercent = normalizeRatePercent(rawRate)
  if (ratePercent < 0 || ratePercent > 100) {
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
