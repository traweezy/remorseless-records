import Skeleton from "@/components/ui/skeleton"

const ProductDetailLoading = () => (
  <div className="space-y-12 px-4 py-16">
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-2xl" />
        ))}
      </div>
      <div className="space-y-4 rounded-2xl border border-border/50 bg-surface/80 p-6">
        <Skeleton className="h-8 w-2/3 rounded-pill" />
        <Skeleton className="h-4 w-1/2 rounded-pill" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-pill" />
          ))}
        </div>
      </div>
    </div>
    <div className="space-y-4 rounded-2xl border border-border/50 bg-surface/80 p-6">
      <Skeleton className="h-6 w-40 rounded-pill" />
      <Skeleton className="h-4 w-full rounded-md" />
      <Skeleton className="h-4 w-5/6 rounded-md" />
      <Skeleton className="h-4 w-2/3 rounded-md" />
    </div>
  </div>
)

export default ProductDetailLoading
