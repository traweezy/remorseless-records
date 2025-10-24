import { Slot } from "@radix-ui/react-slot"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold uppercase tracking-[0.3rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "bg-transparent text-foreground hover:bg-foreground/10",
        outline:
          "border border-border bg-transparent text-foreground hover:border-destructive hover:text-destructive",
        muted: "bg-muted text-muted-foreground hover:bg-muted/80",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-[0.55rem]",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { buttonVariants }
