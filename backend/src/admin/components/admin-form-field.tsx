"use client";

import {
  memo,
  useId,
  type ReactNode,
} from "react";
import {
  Label,
  Text,
  clx,
} from "@medusajs/ui";

export type AdminFormControlProps = {
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  id: string;
};

export type AdminFormFieldProps = {
  children: (controlProps: AdminFormControlProps) => ReactNode;
  className?: string;
  error?: ReactNode;
  hint?: ReactNode;
  id?: string;
  label: ReactNode;
  optional?: boolean;
};

type AdminFormFieldIds = {
  description: string | undefined;
  error: string;
  hint: string;
  input: string;
};

export const getAdminFormFieldIds = ({
  generatedId,
  hasError,
  hasHint,
  id,
}: {
  generatedId: string;
  hasError: boolean;
  hasHint: boolean;
  id: string | undefined;
}): AdminFormFieldIds => {
  const input = id ?? `admin-field-${generatedId.replaceAll(":", "")}`;
  const hint = `${input}-hint`;
  const error = `${input}-error`;
  const description = [
    ...(hasHint ? [hint] : []),
    ...(hasError ? [error] : []),
  ].join(" ");

  return {
    description: description || undefined,
    error,
    hint,
    input,
  };
};

export const AdminFormField = memo<AdminFormFieldProps>(
  ({
    children,
    className,
    error,
    hint,
    id,
    label,
    optional = false,
  }) => {
    const generatedId = useId();
    const hasError = error !== undefined && error !== null && error !== "";
    const hasHint = hint !== undefined && hint !== null && hint !== "";
    const ids = getAdminFormFieldIds({
      generatedId,
      hasError,
      hasHint,
      id,
    });

    return (
      <div className={clx("flex flex-col", className)}>
        <Label htmlFor={ids.input}>
          {label}
          {optional ? (
            <span className="ml-1 text-ui-fg-subtle">(Optional)</span>
          ) : null}
        </Label>
        {children({
          "aria-describedby": ids.description,
          "aria-invalid": hasError ? true : undefined,
          id: ids.input,
        })}
        {hasHint ? (
          <Text
            className="mt-1 text-ui-fg-subtle"
            id={ids.hint}
            size="xsmall"
          >
            {hint}
          </Text>
        ) : null}
        {hasError ? (
          <Text
            className="mt-1 text-ui-fg-error"
            id={ids.error}
            role="alert"
            size="xsmall"
          >
            {error}
          </Text>
        ) : null}
      </div>
    );
  },
);

AdminFormField.displayName = "AdminFormField";
