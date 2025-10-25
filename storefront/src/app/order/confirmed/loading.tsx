import Skeleton from "@/components/ui/skeleton"

const OrderConfirmedLoading = () => (
  <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16">
    <div className="rounded-lg border border-border bg-surface/80 p-8 shadow-elegant">
      <Skeleton className="h-8 w-48 rounded-pill" />
      <Skeleton className="mt-2 h-4 w-2/3 rounded-pill" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/40 p-4">
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
    <Skeleton className="h-10 w-56 self-center rounded-full" />
  </div>
)

export default OrderConfirmedLoading
