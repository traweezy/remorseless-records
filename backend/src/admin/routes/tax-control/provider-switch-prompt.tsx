"use client";

import {
  memo,
  useCallback,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  useForm,
  useStore,
  type AnyFieldApi,
} from "@tanstack/react-form";
import {
  Button,
  Label,
  Prompt,
  Text,
  Textarea,
} from "@medusajs/ui";

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

  return (
    <div>
      <Label htmlFor="tax-switch-reason">Reason for this change</Label>
      <Textarea
        aria-describedby={
          showError
            ? "tax-switch-reason-help tax-switch-reason-error"
            : "tax-switch-reason-help"
        }
        aria-invalid={showError}
        autoFocus
        className="mt-2"
        id="tax-switch-reason"
        maxLength={500}
        name={field.name}
        onBlur={handleBlur}
        onChange={handleChange}
        placeholder="Example: Stripe sandbox validation completed and approved."
        rows={3}
        value={value}
      />
      <Text
        aria-live="polite"
        className="mt-1 text-ui-fg-subtle"
        id="tax-switch-reason-help"
        size="xsmall"
      >
        Required for the audit history · minimum 10 characters · {value.length}
        /500
      </Text>
      {showError ? (
        <Text
          className="mt-1 text-ui-fg-error"
          id="tax-switch-reason-error"
          role="alert"
          size="xsmall"
        >
          Enter a reason between 10 and 500 characters.
        </Text>
      ) : null}
    </div>
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

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open && !busy) {
          onCancel();
        }
      },
      [busy, onCancel],
    );

    const handleSubmit = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      },
      [form],
    );

    return (
      <Prompt
        onOpenChange={handleOpenChange}
        open
        variant="confirmation"
      >
        <Prompt.Content className="max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
          <form noValidate onSubmit={handleSubmit}>
            <Prompt.Header>
              <Prompt.Title>
                Switch to {providerLabel(targetProvider)}?
              </Prompt.Title>
              <Prompt.Description>
                {providerLabel(activeProvider)} remains active until you
                confirm. New or refreshed quotes will then use{" "}
                {providerLabel(targetProvider)}.
              </Prompt.Description>
            </Prompt.Header>

            <div className="mx-6 my-4 rounded-md bg-ui-bg-subtle p-3">
              <Text size="small" weight="plus">
                What stays unchanged
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                {impact.preparedCheckouts} provider-locked checkout
                {impact.preparedCheckouts === 1 ? "" : "s"} and all completed
                orders keep their reviewed tax quote.{" "}
                {impact.paymentsFinalizing} payment
                {impact.paymentsFinalizing === 1 ? "" : "s"}{" "}
                {impact.paymentsFinalizing === 1 ? "is" : "are"} currently
                completing.
              </Text>
            </div>

            <div className="px-6">
              <form.Field
                children={renderSwitchReasonField}
                name="reason"
              />
            </div>

            <Prompt.Footer>
              <Prompt.Cancel disabled={busy} type="button">
                Cancel
              </Prompt.Cancel>
              <Button
                disabled={
                  busy || !formState.canSubmit || formState.isPristine
                }
                isLoading={busy}
                size="small"
                type="submit"
              >
                {busy
                  ? "Switching…"
                  : `Switch to ${providerLabel(targetProvider)}`}
              </Button>
            </Prompt.Footer>
            <div aria-live="polite" className="sr-only">
              {busy ? "Switching tax provider" : ""}
            </div>
          </form>
        </Prompt.Content>
      </Prompt>
    );
  },
);

ProviderSwitchPrompt.displayName = "ProviderSwitchPrompt";
