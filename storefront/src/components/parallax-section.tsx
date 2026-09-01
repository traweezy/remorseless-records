import type { ReactNode } from "react"

import { cn } from "@/lib/ui/cn"

type ParallaxSectionProps = {
  children: ReactNode
  className?: string
}

export const ParallaxSection = ({
  children,
  className,
}: ParallaxSectionProps) => (
  <div className={cn("relative", className)}>{children}</div>
)

export default ParallaxSection
