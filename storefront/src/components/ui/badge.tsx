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
        destructive: "border-destructive bg-destructive text-destructive-foreground",
        accent: "border-destructive bg-destructive/15 text-destructive",
        secondary: "border-border/70 bg-surface text-foreground",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
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
