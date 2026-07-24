"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import { cn } from "@/lib/ui/cn"

type CookiePreferencesEditorProps = {
  className?: string
  onSave?: () => void
}

const CookiePreferencesEditor = ({
  className,
  onSave,
}: CookiePreferencesEditorProps) => {
  const { preferences, saveSelection, acceptAll, rejectNonEssential } =
    useCookieConsent()

  return (
    <div className={cn("space-y-4", className)}>
      <Card variant="inset" className="space-y-3 bg-background/85 p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked
            disabled
            aria-label="Strictly necessary cookies"
            aria-readonly
            className="h-6 w-6"
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Strictly necessary cookies
            </p>
            <p className="text-xs text-muted-foreground">
              Required for cart, checkout, and security controls. These cannot
              be disabled.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            aria-label="Analytics cookies"
            checked={preferences.analytics}
            className="h-6 w-6"
            onCheckedChange={(value) => {
              saveSelection({
                analytics: Boolean(value),
                marketing: preferences.marketing,
              })
            }}
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Analytics cookies
            </p>
            <p className="text-xs text-muted-foreground">
              Helps us understand site usage trends and performance bottlenecks.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            aria-label="Marketing cookies"
            checked={preferences.marketing}
            className="h-6 w-6"
            onCheckedChange={(value) => {
              saveSelection({
                analytics: preferences.analytics,
                marketing: Boolean(value),
              })
            }}
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Marketing cookies
            </p>
            <p className="text-xs text-muted-foreground">
              Supports campaign attribution and promotional message relevance.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outlined"
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
          variant="filled"
          onClick={() => {
            acceptAll()
            onSave?.()
          }}
        >
          Accept all
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Preference changes are saved immediately.
      </p>
    </div>
  )
}

export default CookiePreferencesEditor
