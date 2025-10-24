import { cn } from "@/lib/ui/cn"

export const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical"
}) => (
  <div
    role="separator"
    className={cn(
      "bg-border/60",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className
    )}
    {...props}
  />
)
