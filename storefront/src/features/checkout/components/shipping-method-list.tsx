"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { CheckoutApiError } from "@/features/checkout/api/checkout-api"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import type { CheckoutShippingOption } from "@/features/checkout/types/checkout"
import { formatAmount } from "@/lib/money"

type ShippingMethodListProps = {
  options: CheckoutShippingOption[]
  currentOptionId: string | null
  isLoading: boolean
  isPending: boolean
  error: Error | null
  onRefresh: () => Promise<void>
  onSelect: (optionId: string) => Promise<void>
}

export const ShippingMethodList = memo<ShippingMethodListProps>(
  ({
    options,
    currentOptionId,
    isLoading,
    isPending,
    error,
    onRefresh,
    onSelect,
  }) => {
    const availableOptions = useMemo(
      () => options.filter((option) => !option.insufficientInventory),
      [options]
    )
    const [selectedOptionId, setSelectedOptionId] = useState(
      currentOptionId ?? availableOptions[0]?.id ?? ""
    )
    const autoSelectedRef = useRef<string | null>(null)
    const selectOption = useCallback(
      async (optionId: string): Promise<void> => {
        try {
          await onSelect(optionId)
        } catch {
          // The mutation owns the customer-facing problem state.
        }
      },
      [onSelect]
    )

    useEffect(() => {
      if (
        currentOptionId &&
        availableOptions.some((option) => option.id === currentOptionId)
      ) {
        setSelectedOptionId(currentOptionId)
        return
      }
      setSelectedOptionId(availableOptions[0]?.id ?? "")
    }, [availableOptions, currentOptionId])

    useEffect(() => {
      const onlyOption = availableOptions[0]
      if (
        availableOptions.length !== 1 ||
        !onlyOption ||
        currentOptionId === onlyOption.id ||
        autoSelectedRef.current === onlyOption.id ||
        isPending
      ) {
        return
      }
      autoSelectedRef.current = onlyOption.id
      setSelectedOptionId(onlyOption.id)
      void selectOption(onlyOption.id)
    }, [availableOptions, currentOptionId, isPending, selectOption])

    const message =
      error && "problem" in error
        ? (error as CheckoutApiError).problem.detail
        : (error?.message ?? null)

    if (isLoading && options.length === 0) {
      return (
        <div
          className="min-h-24 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground"
          role="status"
        >
          Loading available delivery methods…
        </div>
      )
    }

    if (availableOptions.length === 0) {
      return (
        <CheckoutProblem
          message={
            message ??
            "No delivery method is available for this address. Check the address or try again."
          }
          title="Delivery is unavailable"
          onRetry={() => void onRefresh()}
        />
      )
    }

    const saveSelection = async (): Promise<void> => {
      if (!selectedOptionId || selectedOptionId === currentOptionId) {
        return
      }
      await onSelect(selectedOptionId)
    }

    return (
      <div className="space-y-5">
        <CheckoutProblem
          message={message}
          title="Delivery method was not saved"
          {...(message && availableOptions[0]
            ? {
                onRetry: () => void selectOption(availableOptions[0]!.id),
              }
            : {})}
        />
        <RadioGroup
          value={selectedOptionId}
          onValueChange={setSelectedOptionId}
          aria-label="Delivery method"
        >
          {availableOptions.map((option) => (
            <label
              key={option.id}
              htmlFor={`shipping-option-${option.id}`}
              className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 transition-colors hover:border-destructive/70 has-[[data-state=checked]]:border-destructive has-[[data-state=checked]]:bg-destructive/5"
            >
              <RadioGroupItem
                id={`shipping-option-${option.id}`}
                value={option.id}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {option.name}
                </span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm font-semibold text-foreground">
                {formatAmount(option.currencyCode, option.amount)}
              </span>
            </label>
          ))}
        </RadioGroup>

        {availableOptions.length > 1 ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={
              isPending ||
              !selectedOptionId ||
              selectedOptionId === currentOptionId
            }
            onClick={() => void saveSelection()}
          >
            {isPending ? "Calculating final total…" : "Continue to payment"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {isPending
              ? "Calculating the final total…"
              : currentOptionId
                ? "Delivery method selected."
                : "Selecting the available delivery method…"}
          </p>
        )}
      </div>
    )
  }
)
ShippingMethodList.displayName = "ShippingMethodList"
