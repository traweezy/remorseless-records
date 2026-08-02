"use client"

import { memo, type ReactNode } from "react"
import { XMark } from "@medusajs/icons"
import { FocusModal, IconButton, Kbd, Text, clx } from "@medusajs/ui"

type AdminFocusModalHeaderProps = {
  className?: string
  description?: ReactNode
  title: ReactNode
}

export const AdminFocusModalHeader = memo<AdminFocusModalHeaderProps>(
  ({ className, description, title }) => (
    <div
      className={clx(
        "flex items-start gap-3 border-b border-ui-border-base px-4 py-3",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2">
        <FocusModal.Close asChild>
          <IconButton
            aria-label="Close dialog"
            size="small"
            type="button"
            variant="transparent"
          >
            <XMark aria-hidden="true" />
          </IconButton>
        </FocusModal.Close>
        <Kbd>esc</Kbd>
      </div>
      <div className="min-w-0 flex-1">
        <FocusModal.Title className="font-medium">
          {title}
        </FocusModal.Title>
        {description ? (
          <FocusModal.Description asChild>
            <Text className="mt-1 min-w-0 text-ui-fg-subtle" size="small">
              {description}
            </Text>
          </FocusModal.Description>
        ) : null}
      </div>
    </div>
  ),
)

AdminFocusModalHeader.displayName = "AdminFocusModalHeader"
