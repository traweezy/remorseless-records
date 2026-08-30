import "server-only"

import { metrics } from "@opentelemetry/api"

type HttpMetric = {
  durationMs: number
  method: string
  status: number
}

type ProviderMetric = {
  durationMs: number
  result: "error" | "ok"
}

const meter = metrics.getMeter("remorseless-records-storefront", "1.0.0")
const httpRequests = meter.createCounter("rr.http.server.requests", {
  description: "Completed Storefront HTTP server requests",
  unit: "{request}",
})
const httpDuration = meter.createHistogram("rr.http.server.duration", {
  description: "Storefront HTTP server request duration",
  unit: "ms",
})
const providerRequests = meter.createCounter("rr.provider.reads", {
  description: "Completed Storefront provider reads",
  unit: "{request}",
})
const providerDuration = meter.createHistogram("rr.provider.read.duration", {
  description: "Storefront provider read duration",
  unit: "ms",
})
const browserEvents = meter.createCounter("rr.browser.telemetry.events", {
  description: "Accepted privacy-bounded browser telemetry events",
  unit: "{event}",
})

const statusClass = (status: number): string =>
  Number.isSafeInteger(status) && status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : "unknown"

const safeMethod = (method: string): string =>
  /^[A-Z]{3,10}$/u.test(method) ? method : "UNKNOWN"

export const recordStorefrontHttpMetric = ({
  durationMs,
  method,
  status,
}: HttpMetric): void => {
  const attributes = {
    "http.request.method": safeMethod(method),
    "http.response.status_class": statusClass(status),
    "service.name": "storefront",
  }
  httpRequests.add(1, attributes)
  httpDuration.record(Math.max(0, durationMs), attributes)
}

export const recordStorefrontProviderMetric = ({
  durationMs,
  result,
}: ProviderMetric): void => {
  const attributes = {
    "operation.name": "provider_read",
    "operation.result": result,
    "service.name": "storefront",
  }
  providerRequests.add(1, attributes)
  providerDuration.record(Math.max(0, durationMs), attributes)
}

export const recordBrowserTelemetryMetric = (
  kind: "client_error" | "web_vital"
): void => {
  browserEvents.add(1, {
    "browser.telemetry.kind": kind,
    "service.name": "storefront",
  })
}
