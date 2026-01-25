import Skeleton from "@/components/ui/skeleton"

const ProductsLoading = () => (
  <div className="bg-background pb-16">
    <div className="container flex flex-col gap-10 px-4 py-10 lg:flex-row lg:gap-12">
      <aside className="hidden lg:block lg:w-72 lg:flex-shrink-0">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] rounded-3xl border border-border/40 bg-background/95 px-6 py-8 text-sm text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70">
          Preparing filters…
        </div>
      </aside>
      <div className="flex-1 space-y-8">
        <header className="sticky top-20 z-10 rounded-3xl border border-border/40 bg-background/95 px-4 py-5 shadow-card backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-8">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.4rem] text-muted-foreground">
              Loading
            </p>
            <h2 className="text-2xl font-semibold uppercase tracking-[0.3rem] text-foreground">
              Preparing releases…
            </h2>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-12 w-full rounded-full" />
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3rem] text-muted-foreground">
              <span>Sort</span>
              <Skeleton className="h-10 w-32 rounded-full" />
            </div>
          </div>
        </header>
        <section className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="space-y-3 rounded-2xl border border-border/40 p-4">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-4 w-3/4 rounded-pill" />
                <Skeleton className="h-3 w-1/2 rounded-pill" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  </div>
)

export default ProductsLoading
