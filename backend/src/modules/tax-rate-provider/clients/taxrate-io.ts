type TaxRateIoResponse = {
  rate?: number | string
  rate_pct?: number | string
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

export const fetchTaxRateIo = async ({
  apiKey,
  zip,
  timeoutMs,
}: {
  apiKey: string
  zip: string
  timeoutMs: number
}): Promise<number> => {
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

    return normalizeRatePercent(rawRate)
  } finally {
    clearTimeout(timeout)
  }
}
