import { Skeleton } from "@/components/ui/skeleton"

const NewsLoading = () => {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-10 px-4 pb-20 pt-12 lg:px-8">
        <header className="space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-4 w-full max-w-3xl" />
            <Skeleton className="h-4 w-11/12 max-w-2xl" />
          </div>
        </header>

        <section className="flex-1 space-y-8">
          {[0, 1].map((index) => (
            <div
              key={`news-loading-${index}`}
              className="rounded-3xl border border-border/40 bg-muted/5 p-5 md:p-8"
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
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

export default NewsLoading
