type TaxRateIoResponse = {
  rate?: number | string
  rate_pct?: number | string
  usage_data?: {
    quota?: number | string
    usage?: number | string
    usage_pct?: number | string
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
  quota: TaxRateIoQuota | null
  ratePercent: number
}

const parseRateValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
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

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = parseRateValue(value)
  if (parsed === null || parsed < 0) {
    return null
  }

  return Math.trunc(parsed)
}

const parseQuota = (
  value: TaxRateIoResponse["usage_data"]
): TaxRateIoQuota | null => {
  if (!value) {
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

export const fetchTaxRateIo = async ({
  apiKey,
  zip,
  timeoutMs,
}: {
  apiKey: string
  zip: string
  timeoutMs: number
}): Promise<TaxRateIoResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const url = new URL('https://www.taxrate.io/api/v1/rate/getratebyzip')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('zip', zip)

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Taxrate.io request failed (${response.status})`)
    }

    const payload = (await response.json()) as TaxRateIoResponse
    const rawRate = parseRateValue(payload.rate ?? payload.rate_pct)

    if (rawRate === null) {
      throw new Error('Taxrate.io returned an invalid rate')
    }

    return {
      quota: parseQuota(payload.usage_data),
      ratePercent: normalizeRatePercent(rawRate),
    }
  } finally {
    clearTimeout(timeout)
  }
}
