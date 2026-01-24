"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { Accordion } from "radix-ui"

import { cn } from "@/lib/ui/cn"

const AccordionRoot = Accordion.Root

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof Accordion.Item>,
  React.ComponentPropsWithoutRef<typeof Accordion.Item>
>(({ className, ...props }, ref) => (
  <Accordion.Item
    ref={ref}
    className={cn("border-b border-border/60", className)}
    {...props}
  />
))
AccordionItem.displayName = "AccordionItem"

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof Accordion.Trigger>,
  React.ComponentPropsWithoutRef<typeof Accordion.Trigger>
>(({ className, children, ...props }, ref) => (
  <Accordion.Header className="flex">
    <Accordion.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 text-left text-sm font-semibold transition hover:text-foreground",
        "[&[data-state=open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-3">{children}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
    </Accordion.Trigger>
  </Accordion.Header>
))
AccordionTrigger.displayName = "AccordionTrigger"

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof Accordion.Content>,
  React.ComponentPropsWithoutRef<typeof Accordion.Content>
>(({ className, children, ...props }, ref) => (
  <Accordion.Content
    ref={ref}
    className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
    {...props}
  >
    <div className={cn("pb-6 pt-2", className)}>{children}</div>
  </Accordion.Content>
))
AccordionContent.displayName = "AccordionContent"

export { AccordionRoot as Accordion, AccordionItem, AccordionTrigger, AccordionContent }
