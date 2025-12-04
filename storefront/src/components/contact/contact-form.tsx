"use client"

import { useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { siteMetadata } from "@/config/site"

const contactSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  reason: z.enum(["booking", "press", "collab", "other"], {
    errorMap: () => ({ message: "Select a reason" }),
  }),
  message: z.string().trim().min(10, "Tell us a bit more"),
  newsletter: z.boolean().optional(),
  honeypot: z.string().optional(),
})

type ContactFormValues = z.infer<typeof contactSchema>

const defaultValues: ContactFormValues = {
  name: "",
  email: "",
  reason: "other",
  message: "",
  newsletter: false,
  honeypot: "",
}

const ContactForm = () => {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
        setErrorMessage(error instanceof Error ? error.message : "Unable to send message")
      }
    },
  })

  const disabled = useMemo(() => status === "submitting", [status])

  return (
    <form
      className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]"
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
              contactSchema.shape.name.safeParse(value).success
                ? undefined
                : "Name is required",
          }}
        >
          {(field) => (
            <label className="block text-sm text-muted-foreground">
              Name
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className="mt-1"
                required
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
              contactSchema.shape.email.safeParse(value).success
                ? undefined
                : "Valid email required",
          }}
        >
          {(field) => (
            <label className="block text-sm text-muted-foreground">
              Email
              <Input
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                className="mt-1"
                required
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
        name="reason"
        validators={{
          onChange: ({ value }) =>
            contactSchema.shape.reason.safeParse(value).success
              ? undefined
              : "Select a reason",
        }}
      >
        {(field) => (
          <label className="block text-sm text-muted-foreground">
            Reason
            <select
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as ContactFormValues["reason"])}
              onBlur={field.handleBlur}
              className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-destructive focus:ring-2 focus:ring-destructive/40"
              required
              aria-invalid={Boolean(field.state.meta.errors[0])}
            >
              <option value="booking">Booking</option>
              <option value="press">Press</option>
              <option value="collab">Collab</option>
              <option value="other">Other</option>
            </select>
            {field.state.meta.errors[0] ? (
              <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
            ) : null}
          </label>
        )}
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
        {(field) => (
          <label className="block text-sm text-muted-foreground">
            Message
            <textarea
              value={field.state.value}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                field.handleChange(event.target.value)
              }
              onBlur={field.handleBlur}
              rows={6}
              className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-destructive focus:ring-2 focus:ring-destructive/40"
              required
              aria-invalid={Boolean(field.state.meta.errors[0])}
            />
            {field.state.meta.errors[0] ? (
              <p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
            ) : null}
          </label>
        )}
      </form.Field>

      <form.Field name="newsletter" defaultValue={false}>
        {(field) => (
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={field.state.value ?? false}
              onChange={(event) => field.handleChange(event.target.checked)}
              className="h-4 w-4 rounded border-border/70 bg-background text-destructive focus:ring-destructive"
            />
            Keep me posted on new drops and represses
          </label>
        )}
      </form.Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={disabled}
          size="sm"
          className="inline-flex items-center gap-2 rounded-full px-4"
        >
          {status === "submitting" ? "Sending..." : "Send message"}
        </Button>
        {status === "success" ? (
          <span className="text-sm text-foreground">Message sent. We’ll reply soon.</span>
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

export default ContactForm
