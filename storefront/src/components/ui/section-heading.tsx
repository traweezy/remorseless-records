import type { ReactNode } from "react"

import { cn } from "@/lib/ui/cn"

type SectionHeadingProps = React.HTMLAttributes<HTMLElement> & {
  leading: ReactNode
  highlight?: ReactNode
  description?: ReactNode
}

export const SectionHeading = ({
  leading,
  highlight,
  description,
  className,
  ...props
}: SectionHeadingProps) => (
  <header className={cn("text-center", className)} {...props}>
    <h2 className="font-bebas text-5xl uppercase tracking-[0.55rem] text-foreground md:text-6xl">
      {leading}
      {highlight ? (
        <>
          {" "}
          <span className="text-destructive">{highlight}</span>
        </>
      ) : null}
    </h2>
    {description ? (
      <p className="mt-3 text-base text-muted-foreground md:text-lg">
        {description}
      </p>
    ) : null}
  </header>
)
