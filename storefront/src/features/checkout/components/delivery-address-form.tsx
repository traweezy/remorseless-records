"use client"

import { useForm } from "@tanstack/react-form"
import { Minus, Plus } from "lucide-react"
import { memo, useCallback, useRef, useState } from "react"
import type { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CheckoutAddressPayload,
  CheckoutApiError,
} from "@/features/checkout/api/checkout-api"
import {
  CheckoutErrorSummary,
  type CheckoutErrorSummaryItem,
} from "@/features/checkout/components/checkout-error-summary"
import { CheckoutProblem } from "@/features/checkout/components/checkout-problem"
import { CheckoutTextField } from "@/features/checkout/components/checkout-text-field"
import { checkoutAddressSchema } from "@/features/checkout/schemas/checkout"
import type { CheckoutAddress } from "@/features/checkout/types/checkout"

const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const

type DeliveryAddressFormValues = {
  first_name: string
  last_name: string
  address_1: string
  address_2: string
  city: string
  province: string
  postal_code: string
  country_code: "us"
  phone: string
}

const DELIVERY_FIELD_LABELS = {
  first_name: "First name",
  last_name: "Last name",
  address_1: "Street address",
  address_2: "Apartment, suite, or unit",
  city: "City",
  province: "State",
  postal_code: "ZIP code",
  country_code: "Country",
  phone: "Phone",
} satisfies Record<keyof DeliveryAddressFormValues, string>

type DeliveryAddressFormProps = {
  initialAddress: CheckoutAddress | null
  isPending: boolean
  error: Error | null
  onSubmit: (address: CheckoutAddressPayload) => Promise<void>
}

const defaultsFrom = (
  address: CheckoutAddress | null
): DeliveryAddressFormValues => ({
  first_name: address?.firstName ?? "",
  last_name: address?.lastName ?? "",
  address_1: address?.address1 ?? "",
  address_2: address?.address2 ?? "",
  city: address?.city ?? "",
  province: address?.province ?? "",
  postal_code: address?.postalCode ?? "",
  country_code: "us",
  phone: address?.phone ?? "",
})

const validate = (
  schema: z.ZodType,
  value: string,
  fallback: string
): string | undefined => {
  const parsed = schema.safeParse(value)
  if (parsed.success) {
    return undefined
  }
  return parsed.error.issues[0]?.message ?? fallback
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

export const DeliveryAddressForm = memo<DeliveryAddressFormProps>(
  ({ initialAddress, isPending, error, onSubmit }) => {
    const formRef = useRef<HTMLFormElement | null>(null)
    const errorSummaryRef = useRef<HTMLDivElement | null>(null)
    const [summaryErrors, setSummaryErrors] = useState<
      CheckoutErrorSummaryItem[]
    >([])
    const [showAddress2, setShowAddress2] = useState(
      Boolean(initialAddress?.address2)
    )
    const form = useForm({
      defaultValues: defaultsFrom(initialAddress),
      onSubmit: async ({ value }) => {
        const parsed = checkoutAddressSchema.safeParse(value)
        if (!parsed.success) {
          return
        }
        await onSubmit({
          first_name: parsed.data.first_name,
          last_name: parsed.data.last_name,
          address_1: parsed.data.address_1,
          ...(parsed.data.address_2
            ? { address_2: parsed.data.address_2 }
            : {}),
          city: parsed.data.city,
          province: parsed.data.province,
          postal_code: parsed.data.postal_code,
          country_code: parsed.data.country_code,
          ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
        })
      },
    })

    const handleSubmit = async (
      event: React.FormEvent<HTMLFormElement>
    ): Promise<void> => {
      event.preventDefault()
      const parsed = checkoutAddressSchema.safeParse(form.state.values)
      if (!parsed.success) {
        const seen = new Set<string>()
        const errors = parsed.error.issues.flatMap((issue) => {
          const field = issue.path[0]
          if (
            typeof field !== "string" ||
            !(field in DELIVERY_FIELD_LABELS) ||
            seen.has(field)
          ) {
            return []
          }
          seen.add(field)
          return [
            {
              field,
              label:
                DELIVERY_FIELD_LABELS[field as keyof DeliveryAddressFormValues],
              message: issue.message,
            },
          ]
        })
        setSummaryErrors(errors)
        await form.handleSubmit()
        window.requestAnimationFrame(() => {
          errorSummaryRef.current?.focus()
        })
        return
      }

      setSummaryErrors([])
      await form.handleSubmit()
    }

    const focusField = useCallback((field: string): void => {
      formRef.current?.querySelector<HTMLElement>(`#${field}`)?.focus()
    }, [])

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
        <CheckoutProblem message={message} title="Address was not saved" />
        <CheckoutErrorSummary
          ref={errorSummaryRef}
          errors={summaryErrors}
          onFocusField={focusField}
        />

        <FieldGroup className="sm:grid-cols-2">
          <form.Field
            name="first_name"
            validators={{
              onBlur: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.first_name,
                  value,
                  "Enter a first name."
                ),
              onSubmit: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.first_name,
                  value,
                  "Enter a first name."
                ),
            }}
          >
            {(field) => (
              <CheckoutTextField
                field={field}
                label="First name"
                autoComplete="shipping given-name"
                maxLength={120}
              />
            )}
          </form.Field>
          <form.Field
            name="last_name"
            validators={{
              onBlur: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.last_name,
                  value,
                  "Enter a last name."
                ),
              onSubmit: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.last_name,
                  value,
                  "Enter a last name."
                ),
            }}
          >
            {(field) => (
              <CheckoutTextField
                field={field}
                label="Last name"
                autoComplete="shipping family-name"
                maxLength={120}
              />
            )}
          </form.Field>
        </FieldGroup>

        <form.Field
          name="address_1"
          validators={{
            onBlur: ({ value }) =>
              validate(
                checkoutAddressSchema.shape.address_1,
                value,
                "Enter a street address."
              ),
            onSubmit: ({ value }) =>
              validate(
                checkoutAddressSchema.shape.address_1,
                value,
                "Enter a street address."
              ),
          }}
        >
          {(field) => (
            <CheckoutTextField
              field={field}
              label="Street address"
              autoComplete="shipping address-line1"
              maxLength={255}
            />
          )}
        </form.Field>

        <Button
          type="button"
          variant="ghost"
          size="compact"
          className="px-0"
          onClick={() => setShowAddress2((visible) => !visible)}
          aria-expanded={showAddress2}
          aria-controls="checkout-address-line-2"
        >
          {showAddress2 ? (
            <Minus className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Apartment, suite, or unit
        </Button>

        <div id="checkout-address-line-2" hidden={!showAddress2}>
          {showAddress2 ? (
            <form.Field name="address_2">
              {(field) => (
                <CheckoutTextField
                  field={field}
                  label="Apartment, suite, or unit (optional)"
                  autoComplete="shipping address-line2"
                  maxLength={255}
                />
              )}
            </form.Field>
          ) : null}
        </div>

        <form.Field
          name="city"
          validators={{
            onBlur: ({ value }) =>
              validate(
                checkoutAddressSchema.shape.city,
                value,
                "Enter a city."
              ),
            onSubmit: ({ value }) =>
              validate(
                checkoutAddressSchema.shape.city,
                value,
                "Enter a city."
              ),
          }}
        >
          {(field) => (
            <CheckoutTextField
              field={field}
              label="City"
              autoComplete="shipping address-level2"
              maxLength={120}
            />
          )}
        </form.Field>

        <FieldGroup className="sm:grid-cols-2">
          <form.Field
            name="province"
            validators={{
              onBlur: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.province,
                  value,
                  "Select a state."
                ),
              onSubmit: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.province,
                  value,
                  "Select a state."
                ),
            }}
          >
            {(field) => {
              const fieldError = errorText(field.state.meta.errors[0])
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>State</FieldLabel>
                  <Select
                    name={field.name}
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={Boolean(fieldError)}
                      aria-describedby={
                        fieldError ? `${field.name}-error` : undefined
                      }
                    >
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError id={`${field.name}-error`}>
                    {fieldError}
                  </FieldError>
                </Field>
              )
            }}
          </form.Field>

          <form.Field
            name="postal_code"
            validators={{
              onBlur: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.postal_code,
                  value,
                  "Enter a valid ZIP code."
                ),
              onSubmit: ({ value }) =>
                validate(
                  checkoutAddressSchema.shape.postal_code,
                  value,
                  "Enter a valid ZIP code."
                ),
            }}
          >
            {(field) => (
              <CheckoutTextField
                field={field}
                label="ZIP code"
                autoComplete="shipping postal-code"
                inputMode="numeric"
                maxLength={10}
              />
            )}
          </form.Field>
        </FieldGroup>

        <Field>
          <FieldLabel>Country</FieldLabel>
          <div className="flex h-11 items-center rounded-full border border-border/60 bg-muted/30 px-4 text-sm text-foreground">
            United States
          </div>
        </Field>

        <form.Field name="phone">
          {(field) => (
            <CheckoutTextField
              field={field}
              label="Phone (optional)"
              type="tel"
              inputMode="tel"
              autoComplete="shipping tel"
              maxLength={40}
              description="Used only if the carrier needs help with delivery."
            />
          )}
        </form.Field>

        <Button
          type="submit"
          className="h-auto min-h-11 w-full whitespace-normal px-4 py-3 text-center leading-5 tracking-[0.12rem] sm:w-auto sm:px-6 sm:tracking-[0.3rem]"
          disabled={isPending}
        >
          {isPending ? "Saving delivery…" : "Continue to delivery method"}
        </Button>
      </form>
    )
  }
)
DeliveryAddressForm.displayName = "DeliveryAddressForm"
