"use client";

import {
  memo,
  useCallback,
  type ChangeEvent,
} from "react";
import {
  useForm,
  useStore,
  type AnyFieldApi,
} from "@tanstack/react-form";
import {
  Text,
  Textarea,
} from "@medusajs/ui";

import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field";
import { ConfirmAction } from "../../components/confirm-action";
import {
  providerLabel,
  taxProviderSwitchFormSchema,
  type ProviderName,
} from "./ui-state";

type ProviderSwitchPromptProps = {
  activeProvider: ProviderName;
  impact: {
    paymentsFinalizing: number;
    preparedCheckouts: number;
  };
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
  pending: boolean;
  targetProvider: ProviderName;
};

type SwitchReasonFieldProps = {
  field: AnyFieldApi;
};

const SwitchReasonField = memo<SwitchReasonFieldProps>(({ field }) => {
  const value = typeof field.state.value === "string" ? field.state.value : "";
  const showError =
    !field.state.meta.isValid &&
    (field.state.meta.isTouched || field.form.state.submissionAttempts > 0);

  const handleBlur = useCallback(() => {
    field.handleBlur();
  }, [field]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = (
        event.currentTarget as unknown as {
          value?: unknown;
        }
      ).value;
      field.handleChange(typeof value === "string" ? value : "");
    },
    [field],
  );
  const renderControl = useCallback(
    (controlProps: AdminFormControlProps) => (
      <Textarea
        {...controlProps}
        autoFocus
        className="mt-2"
        maxLength={500}
        name={field.name}
        onBlur={handleBlur}
        onChange={handleChange}
        placeholder="Example: Stripe sandbox validation completed and approved."
        rows={3}
        value={value}
      />
    ),
    [field.name, handleBlur, handleChange, value],
  );

  return (
    <AdminFormField
      error={
        showError
          ? "Enter a reason between 10 and 500 characters."
          : undefined
      }
      hint={
        <>
          Required for the audit history · minimum 10 characters ·{" "}
          <span aria-live="polite">{value.length}/500</span>
        </>
      }
      id="tax-switch-reason"
      label="Reason for this change"
    >
      {renderControl}
    </AdminFormField>
  );
});

SwitchReasonField.displayName = "SwitchReasonField";

const renderSwitchReasonField = (field: AnyFieldApi) => (
  <SwitchReasonField field={field} />
);

export const ProviderSwitchPrompt = memo<ProviderSwitchPromptProps>(
  ({
    activeProvider,
    impact,
    onCancel,
    onConfirm,
    pending,
    targetProvider,
  }) => {
    const form = useForm({
      defaultValues: {
        reason: "",
      },
      onSubmit: async ({ value }) => {
        const parsed = taxProviderSwitchFormSchema.parse(value);
        await onConfirm(parsed.reason);
      },
      validators: {
        onChange: taxProviderSwitchFormSchema,
      },
    });
    const formState = useStore(form.store, (state) => ({
      canSubmit: state.canSubmit,
      isPristine: state.isPristine,
      isSubmitting: state.isSubmitting,
    }));
    const busy = pending || formState.isSubmitting;

    const handleConfirm = useCallback(() => form.handleSubmit(), [form]);

    return (
      <ConfirmAction
        confirmDisabled={!formState.canSubmit || formState.isPristine}
        confirmLabel={`Switch to ${providerLabel(targetProvider)}`}
        description={
          <>
            {providerLabel(activeProvider)} remains active until you confirm.
            New or refreshed quotes will then use{" "}
            {providerLabel(targetProvider)}.
          </>
        }
        onCancel={onCancel}
        onConfirm={handleConfirm}
        open
        pending={busy}
        pendingAnnouncement="Switching tax provider"
        pendingLabel="Switching…"
        title={`Switch to ${providerLabel(targetProvider)}?`}
      >
        <div className="rounded-md bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus">
            What stays unchanged
          </Text>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            {impact.preparedCheckouts} provider-locked checkout
            {impact.preparedCheckouts === 1 ? "" : "s"} and all completed orders
            keep their reviewed tax quote. {impact.paymentsFinalizing} payment
            {impact.paymentsFinalizing === 1 ? "" : "s"}{" "}
            {impact.paymentsFinalizing === 1 ? "is" : "are"} currently
            completing.
          </Text>
        </div>

        <form.Field
          children={renderSwitchReasonField}
          name="reason"
        />
      </ConfirmAction>
    );
  },
);

ProviderSwitchPrompt.displayName = "ProviderSwitchPrompt";
