import { memo } from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type CheckoutTextFieldAdapter = {
  name: string
  state: {
    value: string
    meta: {
      errors: unknown[]
    }
  }
  handleBlur: () => void
  handleChange: (value: string) => void
}

type CheckoutTextFieldProps = {
  field: CheckoutTextFieldAdapter
  label: string
  autoComplete: string
  description?: string
  type?: React.HTMLInputTypeAttribute
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  maxLength?: number
  placeholder?: string
}

const errorText = (error: unknown): string | null => {
  if (typeof error === "string") {
    return error
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return null
}

export const CheckoutTextField = memo<CheckoutTextFieldProps>(
  ({
    field,
    label,
    autoComplete,
    description,
    type = "text",
    inputMode,
    maxLength,
    placeholder,
  }) => {
    const error = errorText(field.state.meta.errors[0])
    const errorId = `${field.name}-error`
    const descriptionId = `${field.name}-description`
    const describedBy = [
      description ? descriptionId : null,
      error ? errorId : null,
    ]
      .filter(Boolean)
      .join(" ")

    return (
      <Field>
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        <Input
          id={field.name}
          name={field.name}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={maxLength}
          placeholder={placeholder}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.currentTarget.value)}
          onBlur={field.handleBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className="normal-case tracking-normal"
        />
        {description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null}
        <FieldError id={errorId}>{error}</FieldError>
      </Field>
    )
  }
)
CheckoutTextField.displayName = "CheckoutTextField"
