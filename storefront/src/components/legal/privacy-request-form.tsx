"use client"

import { useMemo, useState } from "react"
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

const defaultValues: PrivacyRequestValues = {
  name: "",
  email: "",
  requestType: "access",
  details: "",
  orderId: "",
  honeypot: "",
}

const PrivacyRequestForm = () => {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      if (value.honeypot && value.honeypot.trim().length) {
        return
      }

      setStatus("submitting")
      setErrorMessage(null)

      try {
        const response = await fetch("/api/privacy-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string
            error?: string
          }
          throw new Error(
            payload.message ?? payload.error ?? "Unable to submit request"
          )
        }

        setStatus("success")
        form.reset()
      } catch (error) {
        setStatus("error")
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to submit request"
        )
      }
    },
  })

  const disabled = useMemo(() => status === "submitting", [status])

  return (
    <Card
      as="form"
      variant="panel"
      className="space-y-4 p-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
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
            const error = field.state.meta.errors[0]
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
            const error = field.state.meta.errors[0]
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
          const error = field.state.meta.errors[0]
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
          const error = field.state.meta.errors[0]
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
        {status === "success" ? (
          <span className="text-sm text-foreground">
            Request submitted. We respond from {siteMetadata.contact.email}{" "}
            within 5 business days.
          </span>
        ) : null}
        {status === "error" && errorMessage ? (
          <span className="text-sm text-destructive">
            Something went wrong. Please try again or email{" "}
            {siteMetadata.contact.email}.
          </span>
        ) : null}
      </div>
    </Card>
  )
}

export default PrivacyRequestForm
