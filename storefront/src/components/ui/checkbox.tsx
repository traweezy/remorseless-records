"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { Checkbox } from "radix-ui"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/ui/cn"

const checkboxVariants = cva(
  "peer shrink-0 cursor-pointer rounded border border-border shadow-sm transition data-[state=checked]:border-accent data-[state=checked]:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-4 w-4",
        compact: "h-3.5 w-3.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

type CheckboxProps = React.ComponentPropsWithoutRef<typeof Checkbox.Root> &
  VariantProps<typeof checkboxVariants>

const CheckboxRoot = React.forwardRef<
  React.ElementRef<typeof Checkbox.Root>,
  CheckboxProps
>(({ className, size, ...props }, ref) => (
  <Checkbox.Root
    ref={ref}
    className={cn(checkboxVariants({ size }), className)}
    {...props}
  >
    <Checkbox.Indicator className="flex items-center justify-center text-background">
      <Check className="h-3 w-3" />
    </Checkbox.Indicator>
  </Checkbox.Root>
))
CheckboxRoot.displayName = "Checkbox"

export { CheckboxRoot as Checkbox, checkboxVariants }
