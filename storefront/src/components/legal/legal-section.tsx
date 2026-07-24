import type { ReactNode } from "react"

import { cardVariants } from "@/components/ui/card"
import { cn } from "@/lib/ui/cn"

type LegalSectionProps = {
  title: string
  children: ReactNode
}

const LegalSection = ({ title, children }: LegalSectionProps) => (
  <section
    className={cn(
      cardVariants({ variant: "inset" }),
      "space-y-3 bg-background/85 px-4 py-4"
    )}
  >
    <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
      {title}
    </h2>
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
  </section>
)

export default LegalSection
