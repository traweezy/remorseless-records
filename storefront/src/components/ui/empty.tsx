import { cn } from "@/lib/ui/cn"

export const Empty = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-background/80 p-12 text-center text-sm text-muted-foreground",
      className
    )}
    {...props}
  />
)

export const EmptyHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-2", className)} {...props} />
)

export const EmptyTitle = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn(
      "font-headline text-sm uppercase tracking-[0.3rem] text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </h3>
)

export const EmptyDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p
    className={cn("leading-relaxed text-muted-foreground", className)}
    {...props}
  />
)

export const EmptyContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-wrap justify-center gap-3", className)}
    {...props}
  />
)
