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

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  reason: z.enum(["booking", "press", "collab", "other"], {
    error: "Select a reason",
  }),
  message: z.string().trim().min(10, "Tell us a bit more"),
  honeypot: z.string().optional(),
})

type ContactFormValues = z.infer<typeof contactSchema>

const defaultValues: ContactFormValues = {
  name: "",
  email: "",
  reason: "other",
  message: "",
  honeypot: "",
}

const ContactForm = () => {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reasonOptions: [
    PillDropdownOption<ContactFormValues["reason"]>,
    ...Array<PillDropdownOption<ContactFormValues["reason"]>>,
  ] = [
    { value: "booking", label: "Booking" },
    { value: "press", label: "Press" },
    { value: "collab", label: "Collab" },
    { value: "other", label: "Other" },
  ]

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      // simple honeypot: if filled, drop silently
      if (value.honeypot && value.honeypot.trim().length) {
        return
      }

      setStatus("submitting")
      setErrorMessage(null)
      try {
        const response = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        })
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string }
          throw new Error(payload.message ?? "Failed to send message")
        }
        setStatus("success")
        form.reset()
      } catch (error) {
        setStatus("error")
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to send message"
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
              contactSchema.shape.name.safeParse(value).success
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
              contactSchema.shape.email.safeParse(value).success
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
        name="reason"
        validators={{
          onChange: ({ value }) =>
            contactSchema.shape.reason.safeParse(value).success
              ? undefined
              : "Select a reason",
        }}
      >
        {(field) => {
          const error = field.state.meta.errors[0]
          const errorId = `${field.name}-error`
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>Reason</FieldLabel>
              <PillDropdown
                triggerId={field.name}
                value={field.state.value}
                options={reasonOptions}
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

      <form.Field
        name="message"
        validators={{
          onChange: ({ value }) =>
            contactSchema.shape.message.safeParse(value).success
              ? undefined
              : "Message must be at least 10 characters",
        }}
      >
        {(field) => {
          const error = field.state.meta.errors[0]
          const errorId = `${field.name}-error`
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>Message</FieldLabel>
              <Textarea
                id={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                rows={6}
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
          size="compact"
          className="gap-2"
        >
          {status === "submitting" ? "Sending..." : "Send message"}
        </Button>
        {status === "success" ? (
          <span className="text-sm text-foreground">
            Message sent. We’ll reply soon.
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

export default ContactForm
