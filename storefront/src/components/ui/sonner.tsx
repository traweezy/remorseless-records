"use client"

import { memo, type ReactElement } from "react"
import {
  Toaster as SonnerToaster,
  type ToastClassnames,
  type ToasterProps,
} from "sonner"

const defaultClassNames = {
  toast:
    "border border-border bg-card text-foreground shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]",
  description: "text-muted-foreground",
  actionButton:
    "min-h-9 rounded-full bg-destructive px-4 font-semibold uppercase tracking-[0.18rem] text-destructive-foreground",
  cancelButton:
    "min-h-9 rounded-full border border-border bg-background px-4 text-foreground",
  closeButton:
    "min-h-6 min-w-6 border-border bg-background text-foreground hover:bg-muted",
} satisfies ToastClassnames

const ToasterComponent = ({
  toastOptions,
  ...props
}: ToasterProps): ReactElement => (
  <SonnerToaster
    theme="dark"
    position="bottom-right"
    closeButton
    richColors
    visibleToasts={3}
    containerAriaLabel="Notifications"
    toastOptions={{
      ...toastOptions,
      classNames: {
        ...defaultClassNames,
        ...toastOptions?.classNames,
      },
    }}
    {...props}
  />
)

export const Toaster = memo<ToasterProps>(ToasterComponent)
Toaster.displayName = "Toaster"
