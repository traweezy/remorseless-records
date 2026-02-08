"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import { cn } from "@/lib/ui/cn"

type CookiePreferencesEditorProps = {
  className?: string
  onSave?: () => void
}

const CookiePreferencesEditor = ({ className, onSave }: CookiePreferencesEditorProps) => {
  const { preferences, saveSelection, acceptAll, rejectNonEssential } = useCookieConsent()

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-3 rounded-2xl border border-border/60 bg-background/85 p-4">
        <div className="flex items-start gap-3">
          <Checkbox id="cookies-necessary" checked disabled aria-readonly />
          <div className="space-y-1">
            <label htmlFor="cookies-necessary" className="text-sm font-semibold text-foreground">
              Strictly necessary cookies
            </label>
            <p className="text-xs text-muted-foreground">
              Required for cart, checkout, and security controls. These cannot be disabled.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="cookies-analytics"
            checked={preferences.analytics}
            onCheckedChange={(value) => {
              saveSelection({
                analytics: Boolean(value),
                marketing: preferences.marketing,
              })
            }}
          />
          <div className="space-y-1">
            <label htmlFor="cookies-analytics" className="text-sm font-semibold text-foreground">
              Analytics cookies
            </label>
            <p className="text-xs text-muted-foreground">
              Helps us understand site usage trends and performance bottlenecks.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="cookies-marketing"
            checked={preferences.marketing}
            onCheckedChange={(value) => {
              saveSelection({
                analytics: preferences.analytics,
                marketing: Boolean(value),
              })
            }}
          />
          <div className="space-y-1">
            <label htmlFor="cookies-marketing" className="text-sm font-semibold text-foreground">
              Marketing cookies
            </label>
            <p className="text-xs text-muted-foreground">
              Supports campaign attribution and promotional message relevance.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            rejectNonEssential()
            onSave?.()
          }}
        >
          Reject non-essential
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            acceptAll()
            onSave?.()
          }}
        >
          Accept all
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Preference changes are saved immediately.</p>
    </div>
  )
}

export default CookiePreferencesEditor
