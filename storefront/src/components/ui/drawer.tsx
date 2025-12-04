import * as SheetPrimitive from "@radix-ui/react-dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion"

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
  const prefersReducedMotion = useReducedMotion()

  const easeOutExpo = [0.4, 0, 0.2, 1] as const
  const easeInSharp = [0.4, 0, 1, 1] as const

  const overlayTransition: Transition = prefersReducedMotion
    ? { duration: 0.18, ease: easeOutExpo }
    : { duration: 0.3, ease: easeOutExpo }

  const panelTransition: Transition = prefersReducedMotion
    ? { duration: 0.24, ease: easeOutExpo }
    : { type: "spring", damping: 30, stiffness: 300, mass: 0.8 }

  const panelExitTransition: Transition = prefersReducedMotion
    ? { duration: 0.18, ease: easeInSharp }
    : { duration: 0.26, ease: easeInSharp }

  const sidePosition = side === "left" ? "left-0" : "right-0"
  const sideBorder = side === "left" ? "border-r" : "border-l"
  const sideRadius = side === "left" ? "sm:rounded-r-2xl" : "sm:rounded-l-2xl"
  const closedX = side === "left" ? "-100%" : "100%"

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence initial={false}>
        {open ? (
          <SheetPrimitive.Portal forceMount>
            <SheetPrimitive.Overlay asChild forceMount>
              <motion.div
                className={cn("fixed inset-0 z-40 bg-black/80 backdrop-blur-sm", overlayClassName)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={overlayTransition}
              />
            </SheetPrimitive.Overlay>

            <SheetPrimitive.Content asChild forceMount>
              <motion.aside
                className={cn(
                  "fixed inset-y-0 z-50 flex h-full w-full flex-col border-border/60 bg-background/95 shadow-glow",
                  sidePosition,
                  sideBorder,
                  sideRadius,
                  maxWidthClassName,
                  panelClassName
                )}
                initial="closed"
                animate={open ? "open" : "closed"}
                exit="closed"
                variants={{
                  open: { x: 0, opacity: 1, transition: panelTransition },
                  closed: {
                    x: prefersReducedMotion ? 0 : closedX,
                    opacity: prefersReducedMotion ? 0 : 1,
                    transition: panelExitTransition,
                  },
                }}
              >
                {ariaLabel ? (
                  <VisuallyHidden>
                    <SheetPrimitive.Title>{ariaLabel}</SheetPrimitive.Title>
                  </VisuallyHidden>
                ) : null}
                {children}
              </motion.aside>
            </SheetPrimitive.Content>
          </SheetPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </SheetPrimitive.Root>
  )
}

export default Drawer
