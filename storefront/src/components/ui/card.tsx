import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"
import type { ComponentPropsWithoutRef, ElementType } from "react"

import { cn } from "@/lib/ui/cn"

const cardVariants = cva("border transition-colors", {
  variants: {
    variant: {
      default: "rounded-3xl border-border/70 bg-surface/80 shadow-card",
      panel:
        "rounded-3xl border-border/70 bg-surface/90 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]",
      inset: "rounded-2xl border-border/60 bg-background/80 shadow-none",
      subtle: "rounded-2xl border-border/60 bg-background/65 shadow-none",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

type CardOwnProps = VariantProps<typeof cardVariants> & {
  className?: string
}

export type CardProps<TElement extends ElementType = "div"> = CardOwnProps & {
  as?: TElement
} & Omit<ComponentPropsWithoutRef<TElement>, keyof CardOwnProps | "as">

export const Card = <TElement extends ElementType = "div">({
  as,
  className,
  variant,
  ...props
}: CardProps<TElement>) => {
  const Comp = as ?? "div"
  return (
    <Comp className={cn(cardVariants({ variant }), className)} {...props} />
  )
}

export const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("space-y-1.5 p-6", className)} {...props} />
)

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  children: React.ReactNode
}

export const CardTitle = ({
  className,
  children,
  ...props
}: CardTitleProps) => (
  <h3
    className={cn(
      "font-headline text-lg uppercase tracking-[0.4rem] text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </h3>
)

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-muted-foreground", className)} {...props} />
)

export const CardContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...props} />
)

export const CardFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
)

export { cardVariants }
