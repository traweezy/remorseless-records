import { Check, Circle, Pencil } from "lucide-react"
import { memo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/ui/cn"

type CheckoutSectionProps = {
  step: number
  title: string
  description: string
  complete?: boolean
  disabled?: boolean
  summary?: ReactNode
  onEdit?: () => void
  children: ReactNode
}

export const CheckoutSection = memo<CheckoutSectionProps>(
  ({
    step,
    title,
    description,
    complete = false,
    disabled = false,
    summary,
    onEdit,
    children,
  }) => (
    <Card
      as="section"
      variant="panel"
      aria-labelledby={`checkout-step-${step}`}
      className={cn(disabled && "opacity-60")}
    >
      <CardHeader className="flex flex-col items-start gap-4 space-y-0 sm:flex-row sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              complete
                ? "border-destructive bg-destructive text-destructive-foreground"
                : "border-border text-muted-foreground"
            )}
            aria-hidden="true"
          >
            {complete ? (
              <Check className="h-4 w-4" />
            ) : (
              <Circle className="h-2 w-2 fill-current" />
            )}
          </span>
          <div className="min-w-0">
            <h2
              id={`checkout-step-${step}`}
              className="font-headline text-base uppercase tracking-[0.14rem] text-foreground sm:text-lg sm:tracking-[0.28rem]"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {complete && onEdit ? (
          <Button
            type="button"
            variant="outline"
            size="compact"
            className="h-10 shrink-0 gap-2 border-border/80 px-4 tracking-[0.18rem]"
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {complete && summary ? (
          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-foreground">
            {summary}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
)
CheckoutSection.displayName = "CheckoutSection"
