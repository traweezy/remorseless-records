import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/ui/cn"

type NewsCardSkeletonProps = {
  className?: string
}

export const NewsCardSkeleton = ({ className }: NewsCardSkeletonProps) => (
  <Card
    className={cn(
      "border-border/40 bg-muted/5 p-5 shadow-none md:p-8",
      className
    )}
    aria-hidden
  >
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <Skeleton className="aspect-[4/3] w-full rounded-2xl md:w-5/12" />
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  </Card>
)
