import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Lost in the static",
  description: "The requested page does not exist.",
}

const NotFound = () => (
  <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 px-4 text-center">
    <span className="font-headline text-sm uppercase tracking-[0.75rem] text-muted-foreground">
      404
    </span>
    <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-accent">
      Lost in the Static
    </h1>
    <p className="max-w-md text-sm text-muted-foreground">
      The requested page does not exist.
    </p>
    <Link
      href="/"
      className="inline-flex items-center rounded-full border border-accent px-6 py-2 text-sm uppercase tracking-[0.3rem] text-accent transition hover:bg-accent hover:text-background"
    >
      Back to safety
    </Link>
  </div>
)

export default NotFound
