import type { ReactNode } from "react"

import { cn } from "@/lib/ui/cn"

type PageShellProps = React.HTMLAttributes<HTMLDivElement> & {
  contentClassName?: string
}

export const PageShell = ({
  className,
  contentClassName,
  children,
  ...props
}: PageShellProps) => (
  <div className={cn("bg-background", className)} {...props}>
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 pb-16 pt-12 lg:gap-10 lg:px-8",
        contentClassName
      )}
    >
      {children}
    </div>
  </div>
)

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  descriptionClassName?: string
}

export const PageHeader = ({
  eyebrow,
  title,
  description,
  meta,
  className,
  descriptionClassName,
  ...props
}: PageHeaderProps) => (
  <header className={cn("space-y-3", className)} {...props}>
    <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
      {eyebrow}
    </p>
    <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
      {title}
    </h1>
    {description ? (
      <p
        className={cn(
          "max-w-3xl text-base leading-relaxed text-muted-foreground",
          descriptionClassName
        )}
      >
        {description}
      </p>
    ) : null}
    {meta}
  </header>
)

export const PageContentGrid = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-8",
      className
    )}
    {...props}
  />
)
