import { cn } from "@/lib/ui/cn"
import { forwardRef } from "react"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", onFocus, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-full border border-input bg-background/80 px-4 text-sm uppercase tracking-[0.25rem] text-foreground shadow-sm transition-colors placeholder:text-muted-foreground hover:border-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
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
