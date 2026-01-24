"use client"

import * as React from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Select } from "radix-ui"

import { cn } from "@/lib/ui/cn"

const SelectRoot = Select.Root
const SelectGroup = Select.Group
const SelectValue = Select.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof Select.Trigger>,
  React.ComponentPropsWithoutRef<typeof Select.Trigger>
>(({ className, children, ...props }, ref) => (
  <Select.Trigger
    ref={ref}
    className={cn(
      "flex h-11 w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm",
      "ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    <Select.Icon asChild>
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </Select.Icon>
  </Select.Trigger>
))
SelectTrigger.displayName = "SelectTrigger"

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof Select.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof Select.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <Select.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1 text-muted-foreground",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </Select.ScrollUpButton>
))
SelectScrollUpButton.displayName = "SelectScrollUpButton"

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof Select.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof Select.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <Select.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1 text-muted-foreground",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </Select.ScrollDownButton>
))
SelectScrollDownButton.displayName = "SelectScrollDownButton"

const SelectContent = React.forwardRef<
  React.ElementRef<typeof Select.Content>,
  React.ComponentPropsWithoutRef<typeof Select.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <Select.Portal>
    <Select.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <Select.Viewport
        className={cn(
          "p-1",
          position === "popper" && "h-[var(--radix-select-trigger-height)] w-full"
        )}
      >
        {children}
      </Select.Viewport>
      <SelectScrollDownButton />
    </Select.Content>
  </Select.Portal>
))
SelectContent.displayName = "SelectContent"

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof Select.Label>,
  React.ComponentPropsWithoutRef<typeof Select.Label>
>(({ className, ...props }, ref) => (
  <Select.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)}
    {...props}
  />
))
SelectLabel.displayName = "SelectLabel"

const SelectItem = React.forwardRef<
  React.ElementRef<typeof Select.Item>,
  React.ComponentPropsWithoutRef<typeof Select.Item>
>(({ className, children, ...props }, ref) => (
  <Select.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none",
      "focus:bg-accent/10 focus:text-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <Select.ItemIndicator>
        <Check className="h-4 w-4" />
      </Select.ItemIndicator>
    </span>
    <Select.ItemText>{children}</Select.ItemText>
  </Select.Item>
))
SelectItem.displayName = "SelectItem"

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof Select.Separator>,
  React.ComponentPropsWithoutRef<typeof Select.Separator>
>(({ className, ...props }, ref) => (
  <Select.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
SelectSeparator.displayName = "SelectSeparator"

export {
  SelectRoot as Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
