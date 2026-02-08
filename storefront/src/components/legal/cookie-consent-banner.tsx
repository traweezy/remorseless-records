"use client"

import { useState } from "react"

import CookiePreferencesEditor from "@/components/legal/cookie-preferences-editor"
import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import { Button } from "@/components/ui/button"
import SmartLink from "@/components/ui/smart-link"

const CookieConsentBanner = () => {
  const { isHydrated, hasStoredPreferences, acceptAll, rejectNonEssential } = useCookieConsent()
  const [showManage, setShowManage] = useState(false)

  if (!isHydrated || hasStoredPreferences) {
    return null
  }

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border/70 bg-background/95 shadow-[0_-16px_40px_-28px_rgba(0,0,0,0.85)] backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 lg:px-8">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3rem] text-muted-foreground">Cookie settings</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We only use strictly necessary cookies by default. You can accept all, reject non-essential, or customize your choices.
            Read our{" "}
            <SmartLink href="/privacy" nativePrefetch className="text-destructive underline underline-offset-4">
              Privacy Policy
            </SmartLink>{" "}
            and{" "}
            <SmartLink href="/cookies" nativePrefetch className="text-destructive underline underline-offset-4">
              Cookie Policy
            </SmartLink>
            .
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={acceptAll}>
            Accept all
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={rejectNonEssential}>
            Reject non-essential
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowManage((value) => !value)}>
            {showManage ? "Hide preferences" : "Manage preferences"}
          </Button>
        </div>

        {showManage ? <CookiePreferencesEditor onSave={() => setShowManage(false)} /> : null}
      </div>
    </aside>
  )
}

export default CookieConsentBanner

