import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

const alertVariants = cva(
  "relative w-full rounded-2xl border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        default: "border-border/60 bg-background/80 text-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-foreground",
        accent: "border-destructive/50 bg-destructive/10 text-foreground",
        warning: "border-amber-400/50 bg-amber-500/10 text-amber-200",
        success: "border-emerald-400/50 bg-emerald-500/10 text-emerald-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface AlertProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
)
Alert.displayName = "Alert"

export const AlertTitle = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn(
      "font-headline text-sm uppercase tracking-[0.25rem]",
      className
    )}
    {...props}
  >
    {children}
  </h3>
)

export const AlertDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("mt-1 leading-relaxed", className)} {...props} />
)

export { alertVariants }
