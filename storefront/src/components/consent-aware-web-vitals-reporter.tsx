"use client"

import { memo } from "react"

import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import WebVitalsReporter from "@/components/web-vitals-reporter"

const ConsentAwareWebVitalsReporterComponent = () => {
  const { isHydrated, preferences } = useCookieConsent()

  return isHydrated && preferences.analytics ? <WebVitalsReporter /> : null
}

const ConsentAwareWebVitalsReporter = memo(
  ConsentAwareWebVitalsReporterComponent
)
ConsentAwareWebVitalsReporter.displayName = "ConsentAwareWebVitalsReporter"

export default ConsentAwareWebVitalsReporter
