"use client"

import { forwardRef } from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/ui/cn"

type SliderProps = React.ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> & {
  thumbLabels?: readonly string[]
  getValueText?: (value: number, index: number) => string
}

export const Slider = forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(
  (
    { className, value, defaultValue, thumbLabels, getValueText, ...props },
    ref
  ) => {
    const values = value ?? defaultValue ?? [props.min ?? 0]

    return (
      <SliderPrimitive.Root
        ref={ref}
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        className={cn(
          "relative flex min-h-11 w-full touch-none select-none items-center",
          className
        )}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-border/70">
          <SliderPrimitive.Range className="absolute h-full bg-destructive" />
        </SliderPrimitive.Track>
        {values.map((currentValue, index) => (
          <SliderPrimitive.Thumb
            key={thumbLabels?.[index] ?? index}
            className="block h-7 w-7 cursor-pointer rounded-full border-2 border-destructive bg-background shadow-md transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing motion-reduce:transition-none"
            aria-label={thumbLabels?.[index]}
            aria-valuetext={getValueText?.(currentValue, index)}
          />
        ))}
      </SliderPrimitive.Root>
    )
  }
)
Slider.displayName = "Slider"
