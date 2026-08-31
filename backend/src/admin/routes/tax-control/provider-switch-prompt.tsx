"use client"

import { memo, useCallback, useMemo, type ChangeEvent } from "react"
import { useForm, useStore, type AnyFieldApi } from "@tanstack/react-form"
import { Alert, Input, Text, Textarea } from "@medusajs/ui"

import { TAX_DISABLED_ACKNOWLEDGEMENT } from "../../../modules/tax-control/constants"
import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  focusFirstAdminFormIssue,
  visibleAdminFormFieldError,
  type AdminSaveState,
} from "../../components/admin-form-contract"
import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field"
import { ConfirmAction } from "../../components/confirm-action"
import {
  collectionChoiceLabel,
  taxControlTransitionFormSchema,
  taxControlTransitionIssues,
  type CollectionMode,
  type ProviderName,
} from "./ui-state"

export type TaxControlTransitionConfirmation = {
  acknowledgement?: string
  reason: string
}

type TaxControlTransitionPromptProps = {
  activeCollectionMode: CollectionMode
  activeProvider: ProviderName
  impact: {
    frozenByCollectionMode: Record<CollectionMode, number>
    paymentsFinalizing: number
    preparedCheckouts: number
  }
  onCancel: () => void
  onConfirm: (input: TaxControlTransitionConfirmation) => Promise<void>
  pending: boolean
  targetCollectionMode: CollectionMode
  targetProvider: ProviderName
}

const fieldError = (field: AnyFieldApi): string | undefined =>
  visibleAdminFormFieldError({
    errors: field.state.meta.errors,
    isTouched: field.state.meta.isTouched,
    isValid: field.state.meta.isValid,
    submissionAttempts: field.form.state.submissionAttempts,
  })

type SwitchReasonFieldProps = {
  autoFocus: boolean
  field: AnyFieldApi
}

const SwitchReasonField = memo<SwitchReasonFieldProps>(
  ({ autoFocus, field }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        field.handleChange(event.currentTarget.value)
      },
      [field]
    )
    const renderControl = useCallback(
      (controlProps: AdminFormControlProps) => (
        <Textarea
          {...controlProps}
          autoFocus={autoFocus}
          className="mt-2"
          maxLength={500}
          name={field.name}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder="Example: Approved after reviewing current obligations and open checkouts."
          rows={3}
          value={value}
        />
      ),
      [autoFocus, field.name, handleBlur, handleChange, value]
    )

    return (
      <AdminFormField
        error={fieldError(field)}
        hint={
          <>
            Saved in the audit history · minimum 10 characters ·{" "}
            <span aria-live="polite">{value.length}/500</span>
          </>
        }
        id="tax-transition-reason"
        label="Reason for this change"
      >
        {renderControl}
      </AdminFormField>
    )
  }
)

SwitchReasonField.displayName = "SwitchReasonField"

type AcknowledgementFieldProps = {
  field: AnyFieldApi
}

const AcknowledgementField = memo<AcknowledgementFieldProps>(({ field }) => {
  const value = typeof field.state.value === "string" ? field.state.value : ""
  const handleBlur = useCallback(() => field.handleBlur(), [field])
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      field.handleChange(event.currentTarget.value)
    },
    [field]
  )
  const renderControl = useCallback(
    (controlProps: AdminFormControlProps) => (
      <Input
        {...controlProps}
        autoComplete="off"
        autoFocus
        className="mt-2"
        name={field.name}
        onBlur={handleBlur}
        onChange={handleChange}
        spellCheck={false}
        value={value}
      />
    ),
    [field.name, handleBlur, handleChange, value]
  )

  return (
    <AdminFormField
      error={fieldError(field)}
      hint="Copy the sentence exactly, including punctuation."
      id="tax-disabled-acknowledgement"
      label="Type the acknowledgement"
    >
      {renderControl}
    </AdminFormField>
  )
})

AcknowledgementField.displayName = "AcknowledgementField"

const renderAcknowledgementField = (field: AnyFieldApi) => (
  <AcknowledgementField field={field} />
)

export const TaxControlTransitionPrompt = memo<TaxControlTransitionPromptProps>(
  ({
    activeCollectionMode,
    activeProvider,
    impact,
    onCancel,
    onConfirm,
    pending,
    targetCollectionMode,
    targetProvider,
  }) => {
    const schema = useMemo(
      () => taxControlTransitionFormSchema(targetCollectionMode),
      [targetCollectionMode]
    )
    const form = useForm({
      defaultValues: {
        acknowledgement: "",
        reason: "",
      },
      onSubmit: async ({ value }) => {
        const parsed = schema.parse(value)
        await onConfirm(
          targetCollectionMode === "disabled"
            ? {
                acknowledgement: parsed.acknowledgement,
                reason: parsed.reason,
              }
            : { reason: parsed.reason }
        )
      },
      validators: {
        onBlur: schema,
        onChange: schema,
      },
    })
    const formState = useStore(form.store, (state) => ({
      canSubmit: state.canSubmit,
      isPristine: state.isPristine,
      isSubmitting: state.isSubmitting,
      submissionAttempts: state.submissionAttempts,
      values: state.values,
    }))
    const busy = pending || formState.isSubmitting
    const currentChoice = collectionChoiceLabel(
      activeCollectionMode,
      activeProvider
    )
    const targetChoice = collectionChoiceLabel(
      targetCollectionMode,
      targetProvider
    )

    const renderReasonField = useCallback(
      (field: AnyFieldApi) => (
        <SwitchReasonField
          autoFocus={targetCollectionMode !== "disabled"}
          field={field}
        />
      ),
      [targetCollectionMode]
    )
    const handleConfirm = useCallback(async () => {
      await form.handleSubmit()
      if (!form.state.canSubmit) {
        focusFirstAdminFormIssue(
          taxControlTransitionIssues(targetCollectionMode, form.state.values)
        )
      }
    }, [form, targetCollectionMode])
    const formIssues = useMemo(
      () =>
        formState.submissionAttempts > 0
          ? taxControlTransitionIssues(targetCollectionMode, formState.values)
          : [],
      [formState.submissionAttempts, formState.values, targetCollectionMode]
    )
    const saveState: AdminSaveState = busy
      ? "saving"
      : formState.submissionAttempts > 0 && !formState.canSubmit
        ? "error"
        : formState.isPristine
          ? "idle"
          : "dirty"

    return (
      <ConfirmAction
        confirmDisabled={!formState.canSubmit || formState.isPristine}
        confirmLabel={
          targetCollectionMode === "disabled"
            ? "Turn off tax collection"
            : `Collect using ${
                targetProvider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io"
              }`
        }
        description={
          <>
            {currentChoice} remains active until you confirm. New or refreshed
            quotes will then use {targetChoice.toLocaleLowerCase("en-US")}.
          </>
        }
        onCancel={onCancel}
        onConfirm={handleConfirm}
        open
        pending={busy}
        pendingAnnouncement="Saving the tax collection decision"
        pendingLabel="Saving…"
        title={`${targetChoice}?`}
        variant={
          targetCollectionMode === "disabled" ? "danger" : "confirmation"
        }
      >
        <div className="flex justify-end">
          <AdminFormSaveState state={saveState} />
        </div>
        {targetCollectionMode === "disabled" ? (
          <Alert variant="warning">
            New eligible checkouts will receive a $0.00 tax decision. This does
            not establish that the sales are exempt or outside a tax obligation.
          </Alert>
        ) : null}

        <div className="rounded-md bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus">
            Existing decisions stay frozen
          </Text>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            {impact.preparedCheckouts} prepared checkout
            {impact.preparedCheckouts === 1 ? "" : "s"} keep the decision
            already reviewed: {impact.frozenByCollectionMode.collect} collecting
            and {impact.frozenByCollectionMode.disabled} not collecting. All
            completed orders keep their historical decision.{" "}
            {impact.paymentsFinalizing} payment
            {impact.paymentsFinalizing === 1 ? " is" : "s are"} currently
            completing.
          </Text>
        </div>

        {targetCollectionMode === "disabled" ? (
          <div>
            <Text size="small" weight="plus">
              Required acknowledgement
            </Text>
            <Text
              className="mt-2 select-all rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 font-mono"
              size="small"
            >
              {TAX_DISABLED_ACKNOWLEDGEMENT}
            </Text>
            <form.Field
              children={renderAcknowledgementField}
              name="acknowledgement"
            />
          </div>
        ) : null}

        <form.Field children={renderReasonField} name="reason" />

        <AdminFormErrorSummary
          issues={formIssues}
          title="Review this tax decision"
        />
      </ConfirmAction>
    )
  }
)

TaxControlTransitionPrompt.displayName = "TaxControlTransitionPrompt"
