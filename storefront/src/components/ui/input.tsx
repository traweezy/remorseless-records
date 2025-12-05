import { cn } from "@/lib/ui/cn"
import { forwardRef } from "react"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", onFocus, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full appearance-none rounded-full border border-border/60 bg-background/90 px-4 text-sm uppercase tracking-[0.22rem] text-foreground outline-none transition-[border-color,box-shadow,color] placeholder:text-muted-foreground/80 hover:border-border focus:border-destructive focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:border-destructive focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--destructive)/0.55)] disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      ref={ref}
      onFocus={(event) => {
        event.currentTarget.select()
        onFocus?.(event)
      }}
      {...props}
    />
  )
)
Input.displayName = "Input"
