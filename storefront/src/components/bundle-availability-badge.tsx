"use client"

import { memo } from "react"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import type { BundleItemAvailabilityStatus } from "@/lib/products/bundle-availability"
import { cn } from "@/lib/ui/cn"

type BundleAvailabilityBadgeProps = {
  status: BundleItemAvailabilityStatus
  compact?: boolean
  className?: string
}

const itemStatuses = {
  in_stock: {
    label: "In stock",
    variant: "success",
  },
  sold_out: {
    label: "Sold out",
    variant: "danger",
  },
  unknown: {
    label: "Availability unknown",
    variant: "default",
  },
} satisfies Record<
  BundleItemAvailabilityStatus,
  { label: string; variant: BadgeProps["variant"] }
>

export const BundleAvailabilityBadge = memo<BundleAvailabilityBadgeProps>(
  ({ status, compact = false, className }) => {
    const presentation = itemStatuses[status]
    return (
      <Badge
        variant={presentation.variant}
        className={cn(
          compact
            ? "px-2 py-0.5 text-[0.6rem] tracking-[0.12rem]"
            : "px-2.5 py-1 tracking-[0.22rem]",
          className
        )}
      >
        {presentation.label}
      </Badge>
    )
  }
)
BundleAvailabilityBadge.displayName = "BundleAvailabilityBadge"

export default BundleAvailabilityBadge
