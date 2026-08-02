"use client"

import { memo, useCallback, type ChangeEvent } from "react"
import { Input, Label, Textarea } from "@medusajs/ui"

import {
  CatalogAutomationField,
  CatalogCheckboxField,
  CatalogShelfModeField,
} from "./catalog-shelf-fields"
import type {
  AutomationType,
  ShelfFormState,
  ShelfMode,
} from "./catalog-merchandising-types"

export type ShelfSettingsField = Exclude<
  keyof ShelfFormState,
  "products" | "version"
>

type ShelfTextField =
  | "description"
  | "endsAt"
  | "handle"
  | "productLimit"
  | "ribbonLabel"
  | "ribbonPriority"
  | "startsAt"
  | "title"

type ShelfSettingsChange = (
  field: ShelfSettingsField,
  value: string | boolean,
) => void

const readInputValue = (event: ChangeEvent<HTMLInputElement>): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

const readTextareaValue = (event: ChangeEvent<HTMLTextAreaElement>): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

type ShelfInputFieldProps = {
  disabled: boolean
  field: ShelfTextField
  id: string
  label: string
  min?: string
  onChange: ShelfSettingsChange
  type?: string
  value: string
}

const ShelfInputField = memo<ShelfInputFieldProps>(
  ({ disabled, field, id, label, min, onChange, type, value }) => {
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange(field, readInputValue(event))
      },
      [field, onChange],
    )

    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          disabled={disabled}
          id={id}
          {...(min ? { min } : {})}
          onChange={handleChange}
          {...(type ? { type } : {})}
          value={value}
        />
      </div>
    )
  },
)

ShelfInputField.displayName = "ShelfInputField"

type CatalogShelfSettingsProps = {
  disabled?: boolean
  form: ShelfFormState
  onChange: ShelfSettingsChange
}

export const CatalogShelfSettings = memo<CatalogShelfSettingsProps>(
  ({ disabled = false, form, onChange }) => {
    const handleDescriptionChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange("description", readTextareaValue(event))
      },
      [onChange],
    )

    const handleModeChange = useCallback(
      (value: ShelfMode) => {
        onChange("mode", value)
      },
      [onChange],
    )

    const handleAutomationChange = useCallback(
      (value: AutomationType) => {
        onChange("automationType", value)
      },
      [onChange],
    )

    const handleShowRibbonChange = useCallback(
      (checked: boolean) => {
        onChange("showRibbon", checked)
      },
      [onChange],
    )

    const handleActiveChange = useCallback(
      (checked: boolean) => {
        onChange("isActive", checked)
      },
      [onChange],
    )

    return (
      <fieldset
        aria-label="Shelf settings"
        className="grid gap-4 p-4 md:grid-cols-2"
        disabled={disabled}
      >
        <ShelfInputField
          disabled={disabled}
          field="title"
          id="shelf-title"
          label="Title"
          onChange={onChange}
          value={form.title}
        />
        <ShelfInputField
          disabled={disabled}
          field="handle"
          id="shelf-handle"
          label="Handle"
          onChange={onChange}
          value={form.handle}
        />
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="shelf-description">Description</Label>
          <Textarea
            disabled={disabled}
            id="shelf-description"
            onChange={handleDescriptionChange}
            value={form.description}
          />
        </div>
        <CatalogShelfModeField
          disabled={disabled}
          id="shelf-mode"
          onChange={handleModeChange}
          value={form.mode}
        />
        <CatalogAutomationField
          disabled={disabled}
          id="shelf-automation"
          onChange={handleAutomationChange}
          value={form.automationType}
        />
        <ShelfInputField
          disabled={disabled}
          field="productLimit"
          id="shelf-limit"
          label="Product limit"
          min="1"
          onChange={onChange}
          type="number"
          value={form.productLimit}
        />
        <ShelfInputField
          disabled={disabled}
          field="ribbonPriority"
          id="shelf-priority"
          label="Ribbon priority"
          min="0"
          onChange={onChange}
          type="number"
          value={form.ribbonPriority}
        />
        <ShelfInputField
          disabled={disabled}
          field="ribbonLabel"
          id="shelf-ribbon-label"
          label="Ribbon label"
          onChange={onChange}
          value={form.ribbonLabel}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CatalogCheckboxField
            checked={form.showRibbon}
            disabled={disabled}
            id="shelf-show-ribbon"
            label="Show catalog ribbon"
            onChange={handleShowRibbonChange}
          />
          <CatalogCheckboxField
            checked={form.isActive}
            disabled={disabled}
            id="shelf-active"
            label="Active"
            onChange={handleActiveChange}
          />
        </div>
        <ShelfInputField
          disabled={disabled}
          field="startsAt"
          id="shelf-start"
          label="Starts at"
          onChange={onChange}
          type="datetime-local"
          value={form.startsAt}
        />
        <ShelfInputField
          disabled={disabled}
          field="endsAt"
          id="shelf-end"
          label="Ends at"
          onChange={onChange}
          type="datetime-local"
          value={form.endsAt}
        />
      </fieldset>
    )
  },
)

CatalogShelfSettings.displayName = "CatalogShelfSettings"
