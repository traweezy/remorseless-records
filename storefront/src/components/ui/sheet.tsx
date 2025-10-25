"use client"

import * as SheetPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { forwardRef } from "react"

import { cn } from "@/lib/ui/cn"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

const SheetPortal = (props: SheetPrimitive.DialogPortalProps) => (
  <SheetPrimitive.Portal {...props} />
)
SheetPortal.displayName = SheetPrimitive.Portal.displayName

const SheetOverlay = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out",
      className
    )}
    ref={ref}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

type SheetContentProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
  side?: "top" | "bottom" | "left" | "right"
}

const SheetContent = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "right", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col border border-border/70 bg-background/90 p-6 shadow-glow transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] supports-[backdrop-filter]:backdrop-blur-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out",
        side === "right" &&
          "inset-y-0 right-0 h-full w-full max-w-[448px] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:rounded-l-2xl",
        side === "left" &&
          "inset-y-0 left-0 h-full w-full max-w-[448px] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left sm:rounded-r-2xl",
        side === "top" &&
          "top-0 inset-x-0 h-1/3 border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
        side === "bottom" &&
          "bottom-0 inset-x-0 h-1/3 border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
        className
      )}
      {...props}
    >
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-full border border-border/60 bg-background/80 p-2 text-muted-foreground transition hover:text-destructive">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-1.5 text-left", className)} {...props} />
)

const SheetTitle = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-headline uppercase tracking-[0.35rem] text-foreground",
      className
    )}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
}
