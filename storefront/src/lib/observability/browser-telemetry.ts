export const webVitalNames = [
  "CLS",
  "FCP",
  "FID",
  "INP",
  "LCP",
  "TTFB",
] as const
export const webVitalRatings = ["good", "needs-improvement", "poor"] as const

export type WebVitalName = (typeof webVitalNames)[number]
export type WebVitalRating = (typeof webVitalRatings)[number]

export type BrowserTelemetryPayload =
  | {
      kind: "client_error"
      digest: string
      scope: "application" | "route"
    }
  | {
      kind: "web_vital"
      name: WebVitalName
      rating: WebVitalRating
      value: number
    }

type BrowserTelemetryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

const acceptedWebVitalName = (value: string): value is WebVitalName =>
  (webVitalNames as readonly string[]).includes(value)

const acceptedWebVitalRating = (value: string): value is WebVitalRating =>
  (webVitalRatings as readonly string[]).includes(value)

const roundedMetricValue = (value: number): number | null =>
  Number.isFinite(value) && value >= 0
    ? Number(Math.min(value, 60_000).toFixed(3))
    : null

const postBrowserTelemetry = (
  payload: BrowserTelemetryPayload,
  fetchImpl: BrowserTelemetryFetch
): void => {
  void fetchImpl("/api/telemetry/browser", {
    body: JSON.stringify(payload),
    cache: "no-store",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
    referrerPolicy: "no-referrer",
  }).catch(() => undefined)
}

export const sendWebVitalTelemetry = (
  metric: { name: string; rating: string; value: number },
  fetchImpl: BrowserTelemetryFetch = fetch
): void => {
  const value = roundedMetricValue(metric.value)
  if (
    !acceptedWebVitalName(metric.name) ||
    !acceptedWebVitalRating(metric.rating) ||
    value === null
  ) {
    return
  }
  postBrowserTelemetry(
    {
      kind: "web_vital",
      name: metric.name,
      rating: metric.rating,
      value,
    },
    fetchImpl
  )
}

export const sendClientErrorTelemetry = (
  payload: Extract<BrowserTelemetryPayload, { kind: "client_error" }>,
  fetchImpl: BrowserTelemetryFetch = fetch
): void => {
  postBrowserTelemetry(payload, fetchImpl)
}
