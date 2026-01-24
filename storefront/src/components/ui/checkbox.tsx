"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { Checkbox } from "radix-ui"

import { cn } from "@/lib/ui/cn"

const CheckboxRoot = React.forwardRef<
  React.ElementRef<typeof Checkbox.Root>,
  React.ComponentPropsWithoutRef<typeof Checkbox.Root>
>(({ className, ...props }, ref) => (
  <Checkbox.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded border border-border shadow-sm transition",
      "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <Checkbox.Indicator className="flex items-center justify-center text-background">
      <Check className="h-3 w-3" />
    </Checkbox.Indicator>
  </Checkbox.Root>
))
CheckboxRoot.displayName = "Checkbox"

export { CheckboxRoot as Checkbox }
