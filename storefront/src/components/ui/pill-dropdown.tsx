"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/ui/cn"

export type PillDropdownOption<TValue extends string> = {
  value: TValue
  label: string
  helper?: string
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

type PillDropdownProps<TValue extends string> = {
  value: TValue
  options: [PillDropdownOption<TValue>, ...Array<PillDropdownOption<TValue>>]
  onChange: (value: TValue) => void
  className?: string
  buttonClassName?: string
  dropdownClassName?: string
  align?: "start" | "end"
  renderTriggerLabel?: (option: PillDropdownOption<TValue>) => React.ReactNode
  renderOptionLabel?: (option: PillDropdownOption<TValue>) => React.ReactNode
}

export const PillDropdown = <TValue extends string>({
  value,
  options,
  onChange,
  className,
  buttonClassName,
  dropdownClassName,
  align = "end",
  renderTriggerLabel,
  renderOptionLabel,
}: PillDropdownProps<TValue>) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const activeOption = useMemo<PillDropdownOption<TValue>>(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  )

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) {
        return
      }
      if (!(event.target instanceof Node)) {
        return
      }
      if (!containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKeydown)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKeydown)
    }
  }, [])

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-11 min-w-[220px] appearance-none items-center justify-between rounded-full border border-border/70 bg-background/90 px-4 text-left text-[0.72rem] uppercase tracking-[0.28rem] text-foreground outline-none transition-[border-color,box-shadow,color] supports-[backdrop-filter]:backdrop-blur-lg hover:border-border focus:border-destructive focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:border-destructive focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--destructive)/0.55)]",
          buttonClassName
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[0.65rem]">
          {renderTriggerLabel
            ? renderTriggerLabel(activeOption)
            : (
              <>
                {activeOption.Icon ? (
                  <activeOption.Icon className="h-4 w-4 text-foreground" aria-hidden />
                ) : null}
                {activeOption.label}
              </>
            )}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-foreground transition duration-200", open && "-scale-y-100")}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="pill-dropdown-menu"
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
            className={cn(
              "absolute top-[calc(100%+0.35rem)] z-40 min-w-[260px] rounded-3xl border border-border/50 bg-background/95 p-1.5 shadow-glow supports-[backdrop-filter]:backdrop-blur-2xl",
              align === "start" ? "left-0 right-auto" : "right-0 left-auto",
              dropdownClassName
            )}
          >
            <div role="listbox" className="flex flex-col gap-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-left text-[0.75rem] uppercase tracking-[0.25rem] text-foreground transition hover:border-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive",
                    value === option.value &&
                      "border-destructive text-destructive shadow-[0_0_0_1px_rgba(255,0,0,0.25)]"
                  )}
                  role="option"
                  aria-selected={value === option.value}
                >
                  <span className="flex flex-col">
                    <span
                      className={cn(
                        "flex items-center gap-2 font-semibold",
                        value === option.value ? "text-destructive" : "text-foreground"
                      )}
                    >
                      {option.Icon ? <option.Icon className="h-4 w-4" aria-hidden /> : null}
                      {renderOptionLabel ? renderOptionLabel(option) : option.label}
                    </span>
                    {option.helper ? (
                      <span
                        className={cn(
                          "text-[0.55rem] uppercase tracking-[0.3rem]",
                          value === option.value
                            ? "text-destructive/80"
                            : "text-muted-foreground"
                        )}
                      >
                        {option.helper}
                      </span>
                    ) : null}
                  </span>
                  {value === option.value ? <Check className="h-4 w-4 text-destructive" aria-hidden /> : null}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
