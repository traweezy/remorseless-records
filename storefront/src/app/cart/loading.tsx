import Skeleton from "@/components/ui/skeleton"

const CartLoading = () => (
  <div className="container px-4 py-16 lg:py-24">
    <div className="grid gap-12 lg:grid-cols-[1.6fr_1fr]">
      <section className="space-y-6">
        <Skeleton className="h-10 w-56 rounded-pill" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border/40 p-4">
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ))}
      </section>
      <aside className="space-y-4 rounded-2xl border border-border/50 bg-surface/80 p-6">
        <Skeleton className="h-6 w-32 rounded-pill" />
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full rounded-pill" />
        ))}
        <Skeleton className="h-12 w-full rounded-full" />
      </aside>
    </div>
  </div>
)

export default CartLoading
