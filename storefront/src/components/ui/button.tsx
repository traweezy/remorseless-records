import { Slot } from "@radix-ui/react-slot"
import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

const buttonVariants = cva(
  "inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold uppercase tracking-[0.3rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background active:translate-y-[1px]",
  {
    variants: {
      variant: {
        default: "bg-destructive text-destructive-foreground shadow-[0_10px_30px_-20px_hsla(0,70%,50%,0.75)] hover:bg-destructive/60 hover:shadow-[0_16px_40px_-22px_hsla(0,70%,50%,0.85)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/65",
        ghost: "bg-transparent text-foreground hover:bg-foreground/15 hover:text-foreground/90",
        outline:
          "border border-border bg-transparent text-foreground hover:border-destructive hover:text-destructive hover:bg-destructive/10",
        muted: "bg-muted text-muted-foreground hover:bg-muted/60",
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
