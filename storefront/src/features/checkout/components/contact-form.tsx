"use client"

import { useForm } from "@tanstack/react-form"
import { memo, useRef } from "react"

import { Button } from "@/components/ui/button"
import type { CheckoutApiError } from "@/features/checkout/api/checkout-api"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import { CheckoutTextField } from "@/features/checkout/components/checkout-text-field"
import { checkoutContactSchema } from "@/features/checkout/schemas/checkout"

type ContactFormProps = {
  initialEmail: string
  isPending: boolean
  error: Error | null
  onSubmit: (email: string) => Promise<void>
}

const validateEmail = (value: string): string | undefined => {
  const parsed = checkoutContactSchema.shape.email.safeParse(value)
  return parsed.success ? undefined : "Enter a valid email address."
}

export const ContactForm = memo<ContactFormProps>(
  ({ initialEmail, isPending, error, onSubmit }) => {
    const formRef = useRef<HTMLFormElement | null>(null)
    const form = useForm({
      defaultValues: { email: initialEmail },
      onSubmit: async ({ value }) => {
        const parsed = checkoutContactSchema.safeParse(value)
        if (!parsed.success) {
          return
        }
        await onSubmit(parsed.data.email)
      },
    })

    const handleSubmit = async (
      event: React.FormEvent<HTMLFormElement>
    ): Promise<void> => {
      event.preventDefault()
      await form.handleSubmit()
      window.requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus()
      })
    }

    const message =
      error && "problem" in error
        ? (error as CheckoutApiError).problem.detail
        : (error?.message ?? null)

    return (
      <form
        ref={formRef}
        className="space-y-5"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <CheckoutProblem message={message} title="Contact was not saved" />
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
          }}
        >
          {(field) => (
            <CheckoutTextField
              field={field}
              label="Email address"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={320}
              description="We’ll send the receipt and shipping updates here."
            />
          )}
        </form.Field>
        <Button type="submit" className="w-full sm:w-auto" disabled={isPending}>
          {isPending ? "Saving contact…" : "Continue to delivery"}
        </Button>
      </form>
    )
  }
)
ContactForm.displayName = "ContactForm"
