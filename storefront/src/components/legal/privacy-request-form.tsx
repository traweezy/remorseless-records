"use client"

import { useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PillDropdown, type PillDropdownOption } from "@/components/ui/pill-dropdown"
import { cn } from "@/lib/ui/cn"
import { siteMetadata } from "@/config/site"

const privacyRequestSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required"),
    email: z.string().trim().email("Valid email required"),
    requestType: z.enum(["access", "delete", "correct", "optout", "other"], {
      errorMap: () => ({ message: "Select a request type" }),
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

const fieldBaseClass =
  "mt-1 w-full appearance-none rounded-2xl border border-border/60 bg-background/90 px-3.5 py-2.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus:border-destructive focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:border-destructive focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--destructive)/0.55)]"

const PrivacyRequestForm = () => {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const requestTypeOptions: [
    PillDropdownOption<PrivacyRequestValues["requestType"]>,
    ...Array<PillDropdownOption<PrivacyRequestValues["requestType"]>>
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
          throw new Error(payload.message ?? payload.error ?? "Unable to submit request")
        }

        setStatus("success")
        form.reset()
      } catch (error) {
        setStatus("error")
        setErrorMessage(error instanceof Error ? error.message : "Unable to submit request")
      }
    },
  })

  const disabled = useMemo(() => status === "submitting", [status])

  return (
    <form
      className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <input
        type="text"
        name="company"
        value={form.state.values.honeypot ?? ""}
        onChange={(event) => form.setFieldValue("honeypot", event.target.value)}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) =>
              privacyRequestSchema.shape.name.safeParse(value).success ? undefined : "Name is required",
          }}
        >
          {(field) => (
            <label htmlFor={field.name} className="block text-sm text-muted-foreground">
              Name
              <Input
                id={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className="mt-1"
                aria-invalid={Boolean(field.state.meta.errors[0])}
              />
              {field.state.meta.errors[0] ? (
                <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
              ) : null}
            </label>
          )}
        </form.Field>

        <form.Field
          name="email"
          validators={{
            onChange: ({ value }) =>
              privacyRequestSchema.shape.email.safeParse(value).success ? undefined : "Valid email required",
          }}
        >
          {(field) => (
            <label htmlFor={field.name} className="block text-sm text-muted-foreground">
              Email
              <Input
                id={field.name}
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className="mt-1"
                aria-invalid={Boolean(field.state.meta.errors[0])}
              />
              {field.state.meta.errors[0] ? (
                <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
              ) : null}
            </label>
          )}
        </form.Field>
      </div>

      <form.Field
        name="requestType"
        validators={{
          onChange: ({ value }) =>
            privacyRequestSchema.shape.requestType.safeParse(value).success
              ? undefined
              : "Select a request type",
        }}
      >
        {(field) => (
          <div className="block text-sm text-muted-foreground">
            <p className="mb-1">Request type</p>
            <PillDropdown
              value={field.state.value}
              options={requestTypeOptions}
              onChange={(next) => field.handleChange(next)}
              className="w-full"
              buttonClassName="w-full"
              align="start"
            />
            {field.state.meta.errors[0] ? (
              <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
            ) : null}
          </div>
        )}
      </form.Field>

      <form.Field name="orderId">
        {(field) => (
          <label htmlFor={field.name} className="block text-sm text-muted-foreground">
            Order ID (optional)
            <Input
              id={field.name}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              className="mt-1"
            />
          </label>
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
        {(field) => (
          <label htmlFor={field.name} className="block text-sm text-muted-foreground">
            Details
            <textarea
              id={field.name}
              value={field.state.value}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                field.handleChange(event.target.value)
              }
              onBlur={field.handleBlur}
              rows={5}
              className={cn(fieldBaseClass, "resize-none rounded-2xl")}
              aria-invalid={Boolean(field.state.meta.errors[0])}
            />
            {field.state.meta.errors[0] ? (
              <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
            ) : null}
          </label>
        )}
      </form.Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled} size="sm" className="inline-flex items-center gap-2 rounded-full px-4">
          {status === "submitting" ? "Submitting..." : "Submit privacy request"}
        </Button>
        {status === "success" ? (
          <span className="text-sm text-foreground">
            Request submitted. We respond from {siteMetadata.contact.email} within 5 business days.
          </span>
        ) : null}
        {status === "error" && errorMessage ? (
          <span className="text-sm text-destructive">
            Something went wrong. Please try again or email {siteMetadata.contact.email}.
          </span>
        ) : null}
      </div>
    </form>
  )
}

export default PrivacyRequestForm
