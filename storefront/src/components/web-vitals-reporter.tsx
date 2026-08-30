"use client"

import { useReportWebVitals } from "next/web-vitals"
import { memo, useCallback } from "react"

import { sendWebVitalTelemetry } from "@/lib/observability/browser-telemetry"

type WebVitalsMetric = {
  name: string
  rating: string
  value: number
}

const WebVitalsReporterComponent = () => {
  const handleMetric = useCallback((metric: WebVitalsMetric) => {
    sendWebVitalTelemetry(metric)
  }, [])

  useReportWebVitals(handleMetric)
  return null
}

const WebVitalsReporter = memo(WebVitalsReporterComponent)
WebVitalsReporter.displayName = "WebVitalsReporter"

export default WebVitalsReporter
