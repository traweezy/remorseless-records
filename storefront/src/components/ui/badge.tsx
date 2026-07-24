"use client"

import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.3rem] transition-colors hover:brightness-95 hover:bg-border/20",
  {
    variants: {
      variant: {
        default: "border-border bg-background/70 text-muted-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground",
        danger: "border-destructive/70 bg-destructive/20 text-foreground",
        accent: "border-destructive bg-destructive/15 text-foreground",
        secondary: "border-border/70 bg-surface text-foreground",
        outline: "border-border text-muted-foreground",
        warning: "border-amber-400/70 bg-amber-500/15 text-amber-200",
        success: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export { badgeVariants }
