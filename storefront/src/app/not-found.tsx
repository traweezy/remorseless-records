import type { Metadata } from "next"

import { Button } from "@/components/ui/button"
import SmartLink from "@/components/ui/smart-link"

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
    <Button asChild variant="outlined" size="compact">
      <SmartLink href="/" nativePrefetch>
        Back to safety
      </SmartLink>
    </Button>
  </div>
)

export default NotFound
