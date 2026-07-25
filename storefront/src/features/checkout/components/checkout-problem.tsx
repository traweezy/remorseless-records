import { AlertCircle } from "lucide-react"
import { memo } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/ui/cn"

type CheckoutProblemProps = {
  message: string | null
  title?: string
  onRetry?: () => void
  className?: string
}

export const CheckoutProblem = memo<CheckoutProblemProps>(
  ({ message, title = "Something needs attention", onRetry, className }) => {
    if (!message) {
      return null
    }

    return (
      <div
        role="alert"
        className={cn(
          "rounded-2xl border border-destructive/45 bg-destructive/10 p-4 text-sm text-destructive",
          className
        )}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{title}</p>
            <p className="mt-1">{message}</p>
            {onRetry ? (
              <Button
                type="button"
                variant="outlined"
                size="compact"
                className="mt-3"
                onClick={onRetry}
              >
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }
)
CheckoutProblem.displayName = "CheckoutProblem"
