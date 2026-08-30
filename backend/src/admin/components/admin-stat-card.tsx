"use client"

import { memo, type ReactNode } from "react"
import { Text, clx } from "@medusajs/ui"

type AdminStatCardProps = {
  children: ReactNode
  className?: string
  description?: ReactNode
  label: string
}

export const AdminStatCard = memo<AdminStatCardProps>(
  ({ children, className, description, label }) => (
    <div
      className={clx(
        "rounded-lg border border-ui-border-base bg-ui-bg-base p-4",
        className
      )}
    >
      <Text className="text-ui-fg-subtle" size="xsmall">
        {label}
      </Text>
      <div className="mt-1">{children}</div>
      {description ? (
        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
          {description}
        </Text>
      ) : null}
    </div>
  )
)

AdminStatCard.displayName = "AdminStatCard"
