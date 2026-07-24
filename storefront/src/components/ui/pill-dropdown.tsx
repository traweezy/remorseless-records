"use client"

import { useMemo } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Select } from "radix-ui"

import { Button } from "@/components/ui/button"
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
  triggerId?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  invalid?: boolean
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
  triggerId,
  ariaLabel,
  ariaDescribedBy,
  invalid = false,
  renderTriggerLabel,
  renderOptionLabel,
}: PillDropdownProps<TValue>) => {
  const activeOption = useMemo<PillDropdownOption<TValue>>(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  )

  return (
    <Select.Root
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
    >
      <div className={cn("relative w-full sm:w-auto", className)}>
        <Select.Trigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outlined"
            size="auto"
            className={cn(
              "group inline-flex h-11 w-full min-w-0 appearance-none items-center justify-between rounded-full border border-border/70 bg-background/90 px-4 text-left text-[0.72rem] uppercase tracking-[0.22rem] text-foreground outline-none transition-[border-color,box-shadow,color] supports-[backdrop-filter]:backdrop-blur-lg hover:border-border focus:border-destructive focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:border-destructive focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--destructive)/0.55)] sm:min-w-[220px] sm:tracking-[0.28rem]",
              buttonClassName
            )}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={invalid}
          >
            <span className="flex items-center gap-2 text-[0.65rem]">
              {renderTriggerLabel ? (
                renderTriggerLabel(activeOption)
              ) : (
                <>
                  {activeOption.Icon ? (
                    <activeOption.Icon
                      className="h-4 w-4 text-foreground"
                      aria-hidden
                    />
                  ) : null}
                  {activeOption.label}
                </>
              )}
            </span>
            <Select.Icon asChild>
              <ChevronDown
                className="h-4 w-4 text-foreground transition duration-200 group-data-[state=open]:-scale-y-100"
                aria-hidden
              />
            </Select.Icon>
          </Button>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            align={align}
            className={cn(
              "z-50 w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-3xl border border-border/50 bg-background/95 p-1.5 shadow-glow supports-[backdrop-filter]:backdrop-blur-2xl data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 sm:min-w-[260px]",
              dropdownClassName
            )}
          >
            <Select.Viewport className="flex flex-col gap-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  textValue={option.label}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-left text-[0.75rem] uppercase tracking-[0.25rem] text-foreground outline-none transition data-[highlighted]:border-border/50 data-[highlighted]:bg-muted/40 data-[highlighted]:outline-none data-[state=checked]:border-destructive data-[state=checked]:text-destructive data-[state=checked]:shadow-[0_0_0_1px_rgba(255,0,0,0.25)]"
                  )}
                >
                  <Select.ItemText asChild>
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          "flex items-center gap-2 font-semibold",
                          value === option.value
                            ? "text-destructive"
                            : "text-foreground"
                        )}
                      >
                        {option.Icon ? (
                          <option.Icon className="h-4 w-4" aria-hidden />
                        ) : null}
                        {renderOptionLabel
                          ? renderOptionLabel(option)
                          : option.label}
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
                  </Select.ItemText>
                  <span className="ml-3 flex h-4 w-4 shrink-0 items-center justify-center">
                    <Select.ItemIndicator>
                      <Check className="h-4 w-4 text-destructive" aria-hidden />
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </div>
    </Select.Root>
  )
}
