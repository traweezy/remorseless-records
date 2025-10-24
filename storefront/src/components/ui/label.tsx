"use client"

import * as LabelPrimitive from "@radix-ui/react-label"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-xs font-semibold uppercase tracking-[0.3rem] text-muted-foreground",
      className
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName
