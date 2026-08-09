import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/ui/cn"

type CollectionFilterTriggerProps = {
  activeCount?: number
  className?: string
  controlsId?: string
  expanded?: boolean
  iconOnly?: boolean
  label?: string
  mode?: "drawer" | "sidebar"
  onClick: () => void
}

export const CollectionFilterTrigger = ({
  activeCount = 0,
  className,
  controlsId,
  expanded = false,
  iconOnly = false,
  label = "Filters",
  mode = "drawer",
  onClick,
}: CollectionFilterTriggerProps) => {
  const SidebarIcon = expanded ? PanelLeftClose : PanelLeftOpen
  const Icon = mode === "sidebar" ? SidebarIcon : SlidersHorizontal
  const action = mode === "sidebar" && expanded ? "Hide" : "Show"
  const accessibleLabel = `${action} ${label.toLowerCase()}${
    activeCount ? `, ${activeCount} active` : ""
  }`

  return (
    <Button
      type="button"
      variant="outlined"
      size="icon"
      className={cn(
        "relative shrink-0 border-border/60 bg-background/90 sm:w-auto sm:gap-2 sm:px-4",
        iconOnly && "sm:w-11 sm:px-0",
        className
      )}
      onClick={onClick}
      aria-label={accessibleLabel}
      aria-expanded={expanded}
      aria-controls={controlsId}
      title={accessibleLabel}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className={iconOnly ? "sr-only" : "sr-only sm:not-sr-only"}>
        {label}
      </span>
      {activeCount > 0 ? (
        <span
          className={cn(
            "absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[0.65rem] font-bold leading-none text-destructive-foreground",
            !iconOnly &&
              "sm:static sm:size-auto sm:min-w-5 sm:bg-transparent sm:text-foreground"
          )}
          aria-hidden="true"
        >
          {activeCount}
        </span>
      ) : null}
    </Button>
  )
}
