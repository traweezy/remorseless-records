"use client"

import {
  memo,
  useCallback,
  useMemo,
  type ChangeEvent,
} from "react"
import { Input, Text } from "@medusajs/ui"

import type { AdminFormControlProps } from "../../components/admin-form-field"

export type CatalogControlledOption = {
  id: string
  label: string
}

type CatalogControlledInputProps = {
  control: AdminFormControlProps
  entityLabel: string
  loading: boolean
  name: string
  onChange: (value: string, selectedId: string) => void
  options: CatalogControlledOption[]
  unavailable: boolean
  value: string
}

const normalizeControlledLabel = (value: string): string =>
  value.trim().toLowerCase()

export const CatalogControlledInput = memo<CatalogControlledInputProps>(
  ({
    control,
    entityLabel,
    loading,
    name,
    onChange,
    options,
    unavailable,
    value,
  }) => {
    const listId = `${control.id}-choices`
    const statusId = `${control.id}-selection`
    const selected = useMemo(
      () =>
        options.find(
          (option) =>
            normalizeControlledLabel(option.label) ===
            normalizeControlledLabel(value),
        ),
      [options, value],
    )
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const nextValue = (event.currentTarget as unknown as { value: string })
          .value
        const match = options.find(
          (option) =>
            normalizeControlledLabel(option.label) ===
            normalizeControlledLabel(nextValue),
        )
        onChange(nextValue, match?.id ?? "")
      },
      [onChange, options],
    )
    const description = [control["aria-describedby"], statusId]
      .filter(Boolean)
      .join(" ")

    return (
      <div>
        <Input
          {...control}
          aria-describedby={description}
          list={listId}
          name={name}
          onChange={handleChange}
          value={value}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.id} value={option.label} />
          ))}
        </datalist>
        <Text className="mt-1 text-ui-fg-subtle" id={statusId} size="xsmall">
          {loading
            ? `Loading existing ${entityLabel} choices…`
            : unavailable
              ? "Existing choices are unavailable. Name matching will still be checked safely when the draft is created."
              : selected
                ? `Using existing ${entityLabel}: ${selected.label}.`
                : value.trim()
                  ? `A new ${entityLabel} will be created only if no existing value has this name.`
                  : `Choose an existing ${entityLabel} or enter a new one.`}
        </Text>
      </div>
    )
  },
)

CatalogControlledInput.displayName = "CatalogControlledInput"
