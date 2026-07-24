"use client"

import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import { Slot as SlotPrimitive } from "radix-ui"
import {
  forwardRef,
  type MouseEventHandler,
  type PointerEventHandler,
  type SyntheticEvent,
} from "react"

import { cn } from "@/lib/ui/cn"

const filledButtonClasses =
  "bg-destructive text-destructive-foreground shadow-[0_10px_30px_-20px_hsla(0,70%,50%,0.75)] [&:not([data-disabled=true]):hover]:bg-destructive/60 [&:not([data-disabled=true]):hover]:shadow-[0_16px_40px_-22px_hsla(0,70%,50%,0.85)]"

const outlinedButtonClasses =
  "border border-destructive/70 bg-transparent text-destructive [&:not([data-disabled=true]):hover]:border-destructive [&:not([data-disabled=true]):hover]:bg-destructive/10 [&:not([data-disabled=true]):hover]:text-foreground"

const buttonVariants = cva(
  "inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold uppercase tracking-[0.3rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 ring-offset-background [&:not([data-disabled=true]):active]:translate-y-[1px]",
  {
    variants: {
      variant: {
        filled: filledButtonClasses,
        outlined: outlinedButtonClasses,
        default: filledButtonClasses,
        secondary:
          "bg-secondary text-secondary-foreground [&:not([data-disabled=true]):hover]:bg-secondary/65",
        ghost:
          "bg-transparent text-foreground [&:not([data-disabled=true]):hover]:bg-foreground/15 [&:not([data-disabled=true]):hover]:text-foreground/90",
        outline:
          "border border-border bg-transparent text-foreground [&:not([data-disabled=true]):hover]:border-destructive [&:not([data-disabled=true]):hover]:bg-destructive/10 [&:not([data-disabled=true]):hover]:text-destructive",
        muted:
          "bg-muted text-muted-foreground [&:not([data-disabled=true]):hover]:bg-muted/60",
        unstyled:
          "whitespace-normal rounded-none bg-transparent text-inherit font-normal normal-case tracking-normal shadow-none [&:not([data-disabled=true]):hover]:bg-transparent active:translate-y-0",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-[0.55rem]",
        compact: "h-9 px-4 text-xs tracking-[0.25rem]",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11",
        auto: "",
      },
    },
    defaultVariants: {
      variant: "filled",
      size: "default",
    },
  }
)

const blockDisabledInteraction = (event: SyntheticEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      disabled = false,
      tabIndex,
      onClickCapture,
      onPointerDownCapture,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? SlotPrimitive.Root : "button"
    const ariaDisabled = props["aria-disabled"]
    const isDisabled =
      disabled || ariaDisabled === true || ariaDisabled === "true"
    const handleClickCapture: MouseEventHandler<HTMLButtonElement> = (
      event
    ) => {
      if (isDisabled) {
        blockDisabledInteraction(event)
        return
      }
      onClickCapture?.(event)
    }
    const handlePointerDownCapture: PointerEventHandler<HTMLButtonElement> = (
      event
    ) => {
      if (isDisabled) {
        blockDisabledInteraction(event)
        return
      }
      onPointerDownCapture?.(event)
    }

    return (
      <Comp
        {...props}
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        data-disabled={isDisabled ? "true" : undefined}
        aria-disabled={isDisabled ? true : ariaDisabled}
        tabIndex={asChild && isDisabled ? -1 : tabIndex}
        onClickCapture={handleClickCapture}
        onPointerDownCapture={handlePointerDownCapture}
        {...(!asChild ? { disabled: isDisabled } : {})}
      />
    )
  }
)
Button.displayName = "Button"

export { buttonVariants }
