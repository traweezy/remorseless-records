"use client"

import { forwardRef } from "react"
import { Slot as SlotPrimitive } from "radix-ui"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/ui/cn"

export const InputGroup = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "group flex min-h-11 w-full min-w-0 items-center rounded-full border border-border/60 bg-background/90 transition-[border-color,box-shadow] supports-[backdrop-filter]:backdrop-blur-lg hover:border-border focus-within:border-destructive focus-within:shadow-[0_0_0_2px_hsl(var(--destructive)/0.45)]",
      className
    )}
    {...props}
  />
))
InputGroup.displayName = "InputGroup"

type InputGroupAddonProps = React.HTMLAttributes<HTMLSpanElement> & {
  asChild?: boolean
}

export const InputGroupAddon = forwardRef<
  HTMLSpanElement,
  InputGroupAddonProps
>(({ asChild = false, className, ...props }, ref) => {
  const Comp = asChild ? SlotPrimitive.Root : "span"
  return (
    <Comp
      ref={ref}
      className={cn(
        "flex shrink-0 items-center justify-center text-muted-foreground transition group-focus-within:text-destructive",
        className
      )}
      {...props}
    />
  )
})
InputGroupAddon.displayName = "InputGroupAddon"

export const InputGroupInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, onFocus, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 min-w-0 flex-1 appearance-none border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80 focus:border-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
      className
    )}
    onFocus={(event) => {
      event.currentTarget.select()
      onFocus?.(event)
    }}
    {...props}
  />
))
InputGroupInput.displayName = "InputGroupInput"

export const InputGroupButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "icon", variant = "unstyled", ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      className={cn(
        "shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  )
)
InputGroupButton.displayName = "InputGroupButton"
