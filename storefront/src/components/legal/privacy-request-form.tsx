"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { HoneypotField } from "@/components/ui/honeypot-field"
import { Input } from "@/components/ui/input"
import {
  PillDropdown,
  type PillDropdownOption,
} from "@/components/ui/pill-dropdown"
import { Textarea } from "@/components/ui/textarea"
import { siteMetadata } from "@/config/site"

const privacyRequestSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required"),
    email: z.string().trim().email("Valid email required"),
    requestType: z.enum(["access", "delete", "correct", "optout", "other"], {
      error: "Select a request type",
    }),
    details: z.string().trim().min(10, "Please provide more detail"),
    orderId: z.string().trim().max(120).optional(),
    honeypot: z.string().optional(),
  })
  .strict()

type PrivacyRequestValues = z.infer<typeof privacyRequestSchema>

const privacyRequestResponseSchema = z
  .object({
    ok: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict()

type PrivacyRequestField = keyof PrivacyRequestValues
type ValidationIssue = {
  field: PrivacyRequestField
  label: string
  message: string
}

const fieldLabels: Record<PrivacyRequestField, string> = {
  name: "Name",
  email: "Email",
  requestType: "Request type",
  details: "Details",
  orderId: "Order ID",
  honeypot: "Website",
}

const defaultValues: PrivacyRequestValues = {
  name: "",
  email: "",
  requestType: "access",
  details: "",
  orderId: "",
  honeypot: "",
}

const requestTypeOptions: [
  PillDropdownOption<PrivacyRequestValues["requestType"]>,
  ...Array<PillDropdownOption<PrivacyRequestValues["requestType"]>>,
] = [
  { value: "access", label: "Access data" },
  { value: "delete", label: "Delete data" },
  { value: "correct", label: "Correct data" },
  { value: "optout", label: "Opt-out request" },
  { value: "other", label: "Other" },
]

const validationIssuesFor = (
  values: PrivacyRequestValues
): ValidationIssue[] => {
  const parsed = privacyRequestSchema.safeParse(values)
  if (parsed.success) {
    return []
  }

  const seen = new Set<PrivacyRequestField>()
  return parsed.error.issues.flatMap((issue) => {
    const field = issue.path[0]
    if (typeof field !== "string" || !(field in fieldLabels)) {
      return []
    }
    const typedField = field as PrivacyRequestField
    if (typedField === "honeypot" || seen.has(typedField)) {
      return []
    }
    seen.add(typedField)
    return [
      {
        field: typedField,
        label: fieldLabels[typedField],
        message: issue.message,
      },
    ]
  })
}

const fieldErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === "string") {
    return error
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return undefined
}

const PrivacyRequestForm = () => {
  const [status, setStatus] = useState<
    "idle" | "validation" | "submitting" | "success" | "error"
  >("idle")
  const [requestId, setRequestId] = useState<string | null>(null)
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(
    []
  )
  const resultRef = useRef<HTMLDivElement>(null)

  const form = useForm({
    defaultValues,
    validators: { onSubmit: privacyRequestSchema },
    onSubmitInvalid: ({ value }) => {
      setRequestId(null)
      setValidationIssues(validationIssuesFor(value))
      setStatus("validation")
    },
    onSubmit: async ({ value }) => {
      if (value.honeypot && value.honeypot.trim().length) {
        return
      }

      setStatus("submitting")
      setRequestId(null)
      setValidationIssues([])

      try {
        const response = await fetch("/api/privacy-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        })

        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error("Unable to submit request")
        }

        const parsedResponse = privacyRequestResponseSchema.safeParse(payload)
        if (!parsedResponse.success) {
          throw new Error("Unable to confirm request submission")
        }

        setRequestId(parsedResponse.data.requestId)
        setStatus("success")
        form.reset()
      } catch {
        setStatus("error")
      }
    },
  })

  const disabled = useMemo(() => status === "submitting", [status])
  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      void form.handleSubmit()
    },
    [form]
  )
  const focusField = useCallback((field: PrivacyRequestField): void => {
    document.getElementById(field)?.focus()
  }, [])

  useEffect(() => {
    if (["validation", "success", "error"].includes(status)) {
      resultRef.current?.focus({ preventScroll: false })
    }
  }, [status])

  return (
    <Card
      as="form"
      variant="panel"
      className="space-y-4 p-6"
      noValidate
      onSubmit={handleSubmit}
    >
      <HoneypotField
        value={form.state.values.honeypot ?? ""}
        onChange={(value) => form.setFieldValue("honeypot", value)}
      />

      <FieldGroup className="sm:grid-cols-2">
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) =>
              privacyRequestSchema.shape.name.safeParse(value).success
                ? undefined
                : "Name is required",
          }}
        >
          {(field) => {
            const error = fieldErrorMessage(field.state.meta.errors[0])
            const errorId = `${field.name}-error`
            return (
              <Field>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                />
                <FieldError id={errorId}>{error}</FieldError>
              </Field>
            )
          }}
        </form.Field>

        <form.Field
          name="email"
          validators={{
            onChange: ({ value }) =>
              privacyRequestSchema.shape.email.safeParse(value).success
                ? undefined
                : "Valid email required",
          }}
        >
          {(field) => {
            const error = fieldErrorMessage(field.state.meta.errors[0])
            const errorId = `${field.name}-error`
            return (
              <Field>
                <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                <Input
                  id={field.name}
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                />
                <FieldError id={errorId}>{error}</FieldError>
              </Field>
            )
          }}
        </form.Field>
      </FieldGroup>

      <form.Field
        name="requestType"
        validators={{
          onChange: ({ value }) =>
            privacyRequestSchema.shape.requestType.safeParse(value).success
              ? undefined
              : "Select a request type",
        }}
      >
        {(field) => {
          const error = fieldErrorMessage(field.state.meta.errors[0])
          const errorId = `${field.name}-error`
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>Request type</FieldLabel>
              <PillDropdown
                triggerId={field.name}
                value={field.state.value}
                options={requestTypeOptions}
                onChange={(next) => field.handleChange(next)}
                className="w-full"
                buttonClassName="w-full"
                align="start"
                invalid={Boolean(error)}
                {...(error ? { ariaDescribedBy: errorId } : {})}
              />
              <FieldError id={errorId}>{error}</FieldError>
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="orderId">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Order ID (optional)</FieldLabel>
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </Field>
        )}
      </form.Field>

      <form.Field
        name="details"
        validators={{
          onChange: ({ value }) =>
            privacyRequestSchema.shape.details.safeParse(value).success
              ? undefined
              : "Please provide more detail",
        }}
      >
        {(field) => {
          const error = fieldErrorMessage(field.state.meta.errors[0])
          const errorId = `${field.name}-error`
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>Details</FieldLabel>
              <Textarea
                id={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                rows={5}
                className="resize-none"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
              />
              <FieldError id={errorId}>{error}</FieldError>
            </Field>
          )
        }}
      </form.Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={disabled}
          variant="filled"
          size="sm"
          className="inline-flex items-center gap-2 rounded-full px-4"
        >
          {status === "submitting" ? "Submitting..." : "Submit privacy request"}
        </Button>
      </div>

      {status === "validation" ? (
        <div
          ref={resultRef}
          role="alert"
          aria-labelledby="privacy-validation-title"
          tabIndex={-1}
          className="space-y-2 rounded-2xl border border-destructive/60 bg-background p-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 id="privacy-validation-title" className="font-semibold">
            Check your privacy request
          </h3>
          <ul className="space-y-1">
            {validationIssues.map((issue) => (
              <li key={issue.field}>
                <button
                  type="button"
                  className="inline-flex min-h-6 items-center text-left text-foreground decoration-destructive underline underline-offset-4"
                  onClick={() => focusField(issue.field)}
                >
                  {issue.label}: {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {status === "success" && requestId ? (
        <div
          ref={resultRef}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          tabIndex={-1}
          className="rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Request submitted. Reference ID: <strong>{requestId}</strong>. We
          respond from {siteMetadata.contact.email} within 5 business days.
        </div>
      ) : null}

      {status === "error" ? (
        <div
          ref={resultRef}
          role="alert"
          aria-labelledby="privacy-submit-error-title"
          tabIndex={-1}
          className="rounded-2xl border border-destructive/60 bg-background p-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3 id="privacy-submit-error-title" className="font-semibold">
            Request was not submitted
          </h3>
          <p>
            Try again without changing the request, or email{" "}
            {siteMetadata.contact.email}. No reference ID was issued.
          </p>
        </div>
      ) : null}
    </Card>
  )
}

export default PrivacyRequestForm
