import { NewsCardSkeleton } from "@/components/news/news-card-skeleton"
import { PageShell } from "@/components/ui/page-shell"
import { Skeleton } from "@/components/ui/skeleton"

const NewsLoading = () => {
  return (
    <PageShell
      className="flex min-h-screen flex-col"
      contentClassName="flex-1 gap-10 pb-20"
    >
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
          <NewsCardSkeleton key={`news-loading-${index}`} />
        ))}
      </section>
    </PageShell>
  )
}

export default NewsLoading
