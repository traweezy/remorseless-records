"use client"

import { memo, useCallback } from "react"
import { Checkbox, Label, Select, Text } from "@medusajs/ui"

import {
  automationTypes,
  shelfModes,
  type AutomationType,
  type ShelfMode,
} from "./catalog-merchandising-types"

const shelfModeLabels: Record<ShelfMode, string> = {
  automatic: "Automatic",
  hybrid: "Hybrid",
  manual: "Manual",
}

const automationTypeLabels: Record<AutomationType, string> = {
  new_release: "New releases",
  none: "None",
}

const isShelfMode = (value: string): value is ShelfMode =>
  shelfModes.some((mode) => mode === value)

const isAutomationType = (value: string): value is AutomationType =>
  automationTypes.some((type) => type === value)

type ShelfModeFieldProps = {
  disabled?: boolean
  id: string
  onChange: (value: ShelfMode) => void
  value: ShelfMode
}

export const CatalogShelfModeField = memo<ShelfModeFieldProps>(
  ({ disabled = false, id, onChange, value }) => {
    const handleChange = useCallback(
      (nextValue: string) => {
        if (isShelfMode(nextValue)) {
          onChange(nextValue)
        }
      },
      [onChange]
    )

    return (
      <div className="space-y-2">
        <Label htmlFor={id}>Mode</Label>
        <Select disabled={disabled} onValueChange={handleChange} value={value}>
          <Select.Trigger className="w-full" id={id}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {shelfModes.map((mode) => (
              <Select.Item key={mode} value={mode}>
                {shelfModeLabels[mode]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
    )
  }
)

CatalogShelfModeField.displayName = "CatalogShelfModeField"

type AutomationFieldProps = {
  disabled?: boolean
  id: string
  onChange: (value: AutomationType) => void
  value: AutomationType
}

export const CatalogAutomationField = memo<AutomationFieldProps>(
  ({ disabled = false, id, onChange, value }) => {
    const handleChange = useCallback(
      (nextValue: string) => {
        if (isAutomationType(nextValue)) {
          onChange(nextValue)
        }
      },
      [onChange]
    )

    return (
      <div className="space-y-2">
        <Label htmlFor={id}>Automation</Label>
        <Select disabled={disabled} onValueChange={handleChange} value={value}>
          <Select.Trigger className="w-full" id={id}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {automationTypes.map((type) => (
              <Select.Item key={type} value={type}>
                {automationTypeLabels[type]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
    )
  }
)

CatalogAutomationField.displayName = "CatalogAutomationField"

type CheckboxFieldProps = {
  checked: boolean
  disabled?: boolean
  id: string
  label: string
  onChange: (checked: boolean) => void
}

export const CatalogCheckboxField = memo<CheckboxFieldProps>(
  ({ checked, disabled = false, id, label, onChange }) => {
    const handleChange = useCallback(
      (nextChecked: boolean | "indeterminate") => {
        onChange(nextChecked === true)
      },
      [onChange]
    )

    return (
      <div className="flex min-h-8 items-center gap-2">
        <Checkbox
          aria-label={label}
          checked={checked}
          className="!size-6 shrink-0"
          disabled={disabled}
          id={id}
          onCheckedChange={handleChange}
        />
        <Label
          className={disabled ? "cursor-not-allowed" : "cursor-pointer"}
          htmlFor={id}
        >
          <Text size="small">{label}</Text>
        </Label>
      </div>
    )
  }
)

CatalogCheckboxField.displayName = "CatalogCheckboxField"
