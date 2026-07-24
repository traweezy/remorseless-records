import { ImageOff } from "lucide-react"

import { cn } from "@/lib/ui/cn"

type MediaPlaceholderProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: string
  showIcon?: boolean
}

export const MediaPlaceholder = ({
  className,
  label = "No image",
  showIcon = false,
  ...props
}: MediaPlaceholderProps) => (
  <div
    className={cn(
      "flex h-full w-full items-center justify-center gap-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground",
      className
    )}
    {...props}
  >
    {showIcon ? <ImageOff className="h-4 w-4" aria-hidden /> : null}
    {label ? <span>{label}</span> : null}
  </div>
)
