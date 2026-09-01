"use client"

import { X } from "lucide-react"
import { Dialog as SheetPrimitive, VisuallyHidden } from "radix-ui"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/ui/cn"

type DrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: "left" | "right"
  ariaLabel?: string
  overlayClassName?: string
  panelClassName?: string
  maxWidthClassName?: string
  children: React.ReactNode
}

const Drawer = ({
  open,
  onOpenChange,
  side = "right",
  ariaLabel,
  overlayClassName,
  panelClassName,
  maxWidthClassName = "max-w-[448px]",
  children,
}: DrawerProps) => {
  const sidePosition = side === "left" ? "left-0" : "right-0"
  const sideBorder = side === "left" ? "border-r" : "border-l"
  const sideRadius = side === "left" ? "sm:rounded-r-2xl" : "sm:rounded-l-2xl"
  const sideMotion =
    side === "left"
      ? "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
      : "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay asChild>
          <div
            className={cn(
              "fixed inset-0 z-40 bg-black/80 backdrop-blur-sm duration-200 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out motion-reduce:animate-none",
              overlayClassName
            )}
          />
        </SheetPrimitive.Overlay>

        <SheetPrimitive.Content asChild>
          <aside
            className={cn(
              "fixed inset-y-0 z-50 flex h-full w-full flex-col border-border/60 bg-background shadow-glow duration-300 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out motion-reduce:animate-none",
              sidePosition,
              sideBorder,
              sideRadius,
              sideMotion,
              maxWidthClassName,
              panelClassName
            )}
          >
            {ariaLabel ? (
              <VisuallyHidden.Root>
                <SheetPrimitive.Title>{ariaLabel}</SheetPrimitive.Title>
              </VisuallyHidden.Root>
            ) : null}
            {children}
          </aside>
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  )
}

export const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) => (
  <header
    className={cn(
      "flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4",
      className
    )}
    {...props}
  />
)

export const DrawerHeading = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-1 text-left", className)} {...props} />
)

export const DrawerEyebrow = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p
    className={cn(
      "text-xs font-headline uppercase tracking-[0.16rem] text-muted-foreground sm:tracking-[0.35rem]",
      className
    )}
    {...props}
  />
)

export const DrawerTitle = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2
    className={cn(
      "font-bebas text-2xl uppercase tracking-[0.14rem] text-foreground sm:text-3xl sm:tracking-[0.35rem]",
      className
    )}
    {...props}
  >
    {children}
  </h2>
)

type DrawerCloseButtonProps = Omit<ButtonProps, "children"> & {
  label?: string
}

export const DrawerCloseButton = ({
  className,
  label = "Close drawer",
  ...props
}: DrawerCloseButtonProps) => (
  <SheetPrimitive.Close asChild>
    <Button
      type="button"
      variant="outlined"
      size="icon"
      className={cn(
        "h-11 w-11 shrink-0 border-border/70 text-muted-foreground hover:border-accent hover:text-accent sm:h-9 sm:w-9",
        className
      )}
      aria-label={label}
      {...props}
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  </SheetPrimitive.Close>
)

export default Drawer
