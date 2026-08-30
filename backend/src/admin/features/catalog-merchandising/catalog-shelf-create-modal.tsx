"use client"

import { memo, useCallback, type ChangeEvent, type RefObject } from "react"
import { Button, FocusModal, Input, Label } from "@medusajs/ui"

import { AdminFocusModalHeader } from "../../components/admin-focus-modal-header"
import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  type AdminFormIssue,
  type AdminSaveState,
} from "../../components/admin-form-contract"
import {
  CatalogAutomationField,
  CatalogCheckboxField,
  CatalogShelfModeField,
} from "./catalog-shelf-fields"
import type {
  AutomationType,
  CreateShelfState,
  ShelfMode,
} from "./catalog-merchandising-types"

export type CreateShelfField = keyof CreateShelfState

type CreateShelfChange = (
  field: CreateShelfField,
  value: string | boolean
) => void

type CreateTextField =
  "handle" | "productLimit" | "ribbonLabel" | "ribbonPriority" | "title"

const readInputValue = (event: ChangeEvent<HTMLInputElement>): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

type CreateInputFieldProps = {
  field: CreateTextField
  id: string
  label: string
  min?: string
  onChange: CreateShelfChange
  type?: "number" | "text"
  value: string
}

const CreateInputField = memo<CreateInputFieldProps>(
  ({ field, id, label, min, onChange, type = "text", value }) => {
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange(field, readInputValue(event))
      },
      [field, onChange]
    )

    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          {...(min ? { min } : {})}
          onChange={handleChange}
          type={type}
          value={value}
        />
      </div>
    )
  }
)

CreateInputField.displayName = "CreateInputField"

type CatalogShelfCreateModalProps = {
  form: CreateShelfState
  issues: readonly AdminFormIssue[]
  onChange: CreateShelfChange
  onCreate: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  restoreFocusRef: RefObject<HTMLButtonElement>
  saveState: AdminSaveState
  saving: boolean
}

export const CatalogShelfCreateModal = memo<CatalogShelfCreateModalProps>(
  ({
    form,
    issues,
    onChange,
    onCreate,
    onOpenChange,
    open,
    restoreFocusRef,
    saveState,
    saving,
  }) => {
    const handleModeChange = useCallback(
      (value: ShelfMode) => {
        onChange("mode", value)
      },
      [onChange]
    )

    const handleAutomationChange = useCallback(
      (value: AutomationType) => {
        onChange("automationType", value)
      },
      [onChange]
    )

    const handleRibbonChange = useCallback(
      (checked: boolean) => {
        onChange("showRibbon", checked)
      },
      [onChange]
    )

    const handleCloseAutoFocus = useCallback(
      (event: Event) => {
        event.preventDefault()
        const trigger = restoreFocusRef.current as unknown as {
          focus: () => void
        } | null
        trigger?.focus()
      },
      [restoreFocusRef]
    )

    return (
      <FocusModal onOpenChange={onOpenChange} open={open}>
        <FocusModal.Content
          className="sm:inset-x-1/2 sm:inset-y-8 sm:w-full sm:max-w-3xl sm:-translate-x-1/2"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <AdminFocusModalHeader
            description="Start with the shelf purpose and storefront limits. Add products after the shelf is created."
            title="Create merchandising shelf"
          />
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <div className="mb-5 flex justify-end">
              <AdminFormSaveState state={saveState} />
            </div>
            <AdminFormErrorSummary className="mb-5" issues={issues} />
            <div className="grid gap-4 md:grid-cols-2">
              <CreateInputField
                field="title"
                id="new-shelf-title"
                label="Title"
                onChange={onChange}
                value={form.title}
              />
              <CreateInputField
                field="handle"
                id="new-shelf-handle"
                label="Handle"
                onChange={onChange}
                value={form.handle}
              />
              <CatalogShelfModeField
                id="new-shelf-mode"
                onChange={handleModeChange}
                value={form.mode}
              />
              <CatalogAutomationField
                id="new-shelf-automation"
                onChange={handleAutomationChange}
                value={form.automationType}
              />
              <CreateInputField
                field="ribbonPriority"
                id="new-shelf-priority"
                label="Ribbon priority"
                min="0"
                onChange={onChange}
                type="number"
                value={form.ribbonPriority}
              />
              <CreateInputField
                field="productLimit"
                id="new-shelf-limit"
                label="Product limit"
                min="1"
                onChange={onChange}
                type="number"
                value={form.productLimit}
              />
              <CreateInputField
                field="ribbonLabel"
                id="new-shelf-ribbon"
                label="Ribbon label"
                onChange={onChange}
                value={form.ribbonLabel}
              />
              <div className="pt-7">
                <CatalogCheckboxField
                  checked={form.showRibbon}
                  id="new-shelf-show-ribbon"
                  label="Show catalog ribbon"
                  onChange={handleRibbonChange}
                />
              </div>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <FocusModal.Close asChild>
              <Button disabled={saving} type="button" variant="secondary">
                Cancel
              </Button>
            </FocusModal.Close>
            <Button
              disabled={saving}
              isLoading={saving}
              onClick={onCreate}
              type="button"
            >
              Create shelf
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    )
  }
)

CatalogShelfCreateModal.displayName = "CatalogShelfCreateModal"
