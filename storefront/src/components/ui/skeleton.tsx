import { cn } from "@/lib/ui/cn"

type SkeletonProps = {
  className?: string
}

export const Skeleton = ({ className }: SkeletonProps) => (
  <div className={cn("animate-pulse rounded-lg bg-muted/40", className)} />
)

export default Skeleton
