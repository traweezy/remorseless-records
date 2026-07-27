"use client";

import {
  memo,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Button,
  Prompt,
} from "@medusajs/ui";

type ConfirmActionVariant = "confirmation" | "danger";

export type ConfirmActionProps = {
  cancelLabel?: string;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  open: boolean;
  pending?: boolean;
  pendingAnnouncement?: string;
  pendingLabel?: string;
  title: ReactNode;
  variant?: ConfirmActionVariant;
};

export const getConfirmActionState = ({
  confirmDisabled,
  confirmLabel,
  pending,
  pendingAnnouncement,
  pendingLabel,
}: {
  confirmDisabled: boolean | undefined;
  confirmLabel: string;
  pending: boolean | undefined;
  pendingAnnouncement: string | undefined;
  pendingLabel: string | undefined;
}) => {
  const isPending = pending ?? false;

  return {
    announcement: isPending
      ? (pendingAnnouncement ?? `${pendingLabel ?? confirmLabel} in progress`)
      : "",
    disabled: isPending || (confirmDisabled ?? false),
    label: isPending ? (pendingLabel ?? confirmLabel) : confirmLabel,
  };
};

export const ConfirmAction = memo<ConfirmActionProps>(
  ({
    cancelLabel = "Cancel",
    children,
    confirmDisabled = false,
    confirmLabel,
    description,
    onCancel,
    onConfirm,
    open,
    pending = false,
    pendingAnnouncement,
    pendingLabel,
    title,
    variant = "confirmation",
  }) => {
    const state = getConfirmActionState({
      confirmDisabled,
      confirmLabel,
      pending,
      pendingAnnouncement,
      pendingLabel,
    });

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        if (!nextOpen && !pending) {
          onCancel();
        }
      },
      [onCancel, pending],
    );

    const handleSubmit = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!state.disabled) {
          void onConfirm();
        }
      },
      [onConfirm, state.disabled],
    );

    return (
      <Prompt
        onOpenChange={handleOpenChange}
        open={open}
        variant={variant}
      >
        <Prompt.Content className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
          <form
            aria-busy={pending}
            noValidate
            onSubmit={handleSubmit}
          >
            <Prompt.Header>
              <Prompt.Title>{title}</Prompt.Title>
              <Prompt.Description>{description}</Prompt.Description>
            </Prompt.Header>

            {children ? (
              <div className="flex flex-col gap-y-4 px-6 pt-4">
                {children}
              </div>
            ) : null}

            <Prompt.Footer>
              <Prompt.Cancel disabled={pending} type="button">
                {cancelLabel}
              </Prompt.Cancel>
              <Button
                disabled={state.disabled}
                isLoading={pending}
                size="small"
                type="submit"
                variant={variant === "danger" ? "danger" : "primary"}
              >
                {state.label}
              </Button>
            </Prompt.Footer>
            <div aria-live="polite" className="sr-only">
              {state.announcement}
            </div>
          </form>
        </Prompt.Content>
      </Prompt>
    );
  },
);

ConfirmAction.displayName = "ConfirmAction";
