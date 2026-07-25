import { AlertCircle } from "lucide-react"
import { forwardRef, memo, useCallback } from "react"

import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export type CheckoutErrorSummaryItem = {
  field: string
  label: string
  message: string
}

type CheckoutErrorSummaryProps = {
  errors: CheckoutErrorSummaryItem[]
  onFocusField: (field: string) => void
}

const CheckoutErrorSummaryComponent = forwardRef<
  HTMLDivElement,
  CheckoutErrorSummaryProps
>(({ errors, onFocusField }, ref) => {
  const focusField = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      onFocusField(event.currentTarget.name)
    },
    [onFocusField]
  )

  if (errors.length === 0) {
    return null
  }

  return (
    <Alert
      ref={ref}
      variant="destructive"
      tabIndex={-1}
      aria-labelledby="delivery-address-errors-title"
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div>
          <AlertTitle id="delivery-address-errors-title">
            Check your delivery address
          </AlertTitle>
          <ul className="mt-2 space-y-1">
            {errors.map((error) => (
              <li key={error.field}>
                <Button
                  type="button"
                  name={error.field}
                  variant="unstyled"
                  size="compact"
                  className="h-auto min-h-6 justify-start px-0 py-0 text-left normal-case tracking-normal"
                  onClick={focusField}
                >
                  <span className="font-semibold">{error.label}:</span>{" "}
                  {error.message}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Alert>
  )
})
CheckoutErrorSummaryComponent.displayName = "CheckoutErrorSummary"

export const CheckoutErrorSummary = memo(CheckoutErrorSummaryComponent)
