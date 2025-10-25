"use client"

import type { HTMLAttributes } from "react"

import { cn } from "@/lib/ui/cn"

type ScrollAreaProps = HTMLAttributes<HTMLDivElement>

export const ScrollArea = ({ className, children, ...props }: ScrollAreaProps) => {
  return (
    <div
      className={cn("relative h-full overflow-y-auto overscroll-contain", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export default ScrollArea
