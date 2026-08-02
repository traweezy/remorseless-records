"use client"

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type RefObject,
} from "react"
import { useForm, useStore, type AnyFieldApi } from "@tanstack/react-form"
import {
  Alert,
  Button,
  Drawer,
  FocusModal,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
} from "@medusajs/ui"
import { z } from "zod"

import { AdminFocusModalHeader } from "../../components/admin-focus-modal-header"
import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field"
import {
  discographyAvailabilityValues,
  type DiscographyEntry,
  type ManualDiscographyInput,
} from "./discography-query"

const datePrecisionValues = ["day", "year", "unknown"] as const

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    (value) => value.length === 0 || z.url().safeParse(value).success,
    "Enter a valid http or https URL."
  )

export const discographyManualFormSchema = z
  .object({
    artist: z.string().trim().min(1, "Enter an artist.").max(500),
    availability: z.enum(discographyAvailabilityValues),
    catalogNumber: z.string().trim().max(200),
    collectionTitle: z.string().trim().max(500),
    coverAltText: z.string().trim().max(500),
    coverUrl: optionalUrlSchema,
    datePrecision: z.enum(datePrecisionValues),
    dateValue: z.string().trim().max(10),
    formatsText: z.string().max(5_000),
    genresText: z.string().max(5_000),
    releaseTitle: z.string().trim().min(1, "Enter a release title.").max(500),
    tagsText: z.string().max(5_000),
  })
  .superRefine((value, context) => {
    if (value.datePrecision === "day") {
      const parsed = new Date(`${value.dateValue}T00:00:00.000Z`)
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value.dateValue) ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value.dateValue
      ) {
        context.addIssue({
          code: "custom",
          message: "Enter a valid release date.",
          path: ["dateValue"],
        })
      }
    }
    if (value.datePrecision === "year") {
      const year = Number(value.dateValue)
      if (!/^\d{4}$/.test(value.dateValue) || year < 1900 || year > 2200) {
        context.addIssue({
          code: "custom",
          message: "Enter a year from 1900 through 2200.",
          path: ["dateValue"],
        })
      }
    }
  })

type DiscographyManualFormValues = z.infer<typeof discographyManualFormSchema>

const emptyValues: DiscographyManualFormValues = {
  artist: "",
  availability: "unknown",
  catalogNumber: "",
  collectionTitle: "",
  coverAltText: "",
  coverUrl: "",
  datePrecision: "unknown",
  dateValue: "",
  formatsText: "",
  genresText: "",
  releaseTitle: "",
  tagsText: "",
}

const joinList = (values: string[]): string => values.join(", ")

export const valuesFromDiscographyEntry = (
  entry: DiscographyEntry
): DiscographyManualFormValues => ({
  artist: entry.artist,
  availability: entry.availability,
  catalogNumber: entry.catalogNumber ?? "",
  collectionTitle: entry.collectionTitle ?? "",
  coverAltText: entry.coverAltText ?? "",
  coverUrl: entry.coverUrl ?? "",
  datePrecision: entry.releaseDate
    ? "day"
    : entry.releaseYear
      ? "year"
      : "unknown",
  dateValue: entry.releaseDate
    ? entry.releaseDate.slice(0, 10)
    : entry.releaseYear
      ? String(entry.releaseYear)
      : "",
  formatsText: joinList(entry.formats),
  genresText: joinList(entry.genres),
  releaseTitle: entry.title,
  tagsText: joinList(entry.tags),
})

const splitList = (value: string): string[] => {
  const seen = new Set<string>()
  return value.split(/[,\n]/u).flatMap((part) => {
    const normalized = part.trim()
    const key = normalized.toLocaleLowerCase("en-US")
    if (!normalized || seen.has(key)) {
      return []
    }
    seen.add(key)
    return [normalized]
  })
}

const nullable = (value: string): string | null => {
  const normalized = value.trim()
  return normalized || null
}

export const buildManualDiscographyInput = (
  values: DiscographyManualFormValues
): ManualDiscographyInput => {
  const releaseYear =
    values.datePrecision === "day"
      ? Number(values.dateValue.slice(0, 4))
      : values.datePrecision === "year"
        ? Number(values.dateValue)
        : null

  return {
    artist: values.artist.trim(),
    availability: values.availability,
    catalogNumber: nullable(values.catalogNumber),
    collectionTitle: nullable(values.collectionTitle),
    coverAltText: nullable(values.coverAltText),
    coverUrl: nullable(values.coverUrl),
    formats: splitList(values.formatsText),
    genres: splitList(values.genresText),
    releaseDate: values.datePrecision === "day" ? values.dateValue : null,
    releaseTitle: values.releaseTitle.trim(),
    releaseYear,
    tags: splitList(values.tagsText),
  }
}

const firstFieldError = (field: AnyFieldApi): string | undefined => {
  const first = field.state.meta.errors[0] as unknown
  if (typeof first === "string") {
    return first
  }
  if (first && typeof first === "object" && "message" in first) {
    const message = (first as { message?: unknown }).message
    return typeof message === "string" ? message : undefined
  }
  return undefined
}

const showFieldError = (field: AnyFieldApi): string | undefined =>
  !field.state.meta.isValid &&
  (field.state.meta.isTouched || field.form.state.submissionAttempts > 0)
    ? firstFieldError(field)
    : undefined

type TextFieldProps = {
  field: AnyFieldApi
  hint?: string
  label: string
  maxLength: number
  optional?: boolean
  placeholder?: string
  type?: "date" | "number" | "text" | "url"
}

const DiscographyTextField = memo<TextFieldProps>(
  ({ field, hint, label, maxLength, optional, placeholder, type = "text" }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = (event.currentTarget as unknown as { value?: unknown })
          .value
        field.handleChange(typeof value === "string" ? value : "")
      },
      [field]
    )
    const renderControl = useCallback(
      (control: AdminFormControlProps) => (
        <Input
          {...control}
          className="mt-2"
          maxLength={maxLength}
          name={field.name}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      ),
      [
        field.name,
        handleBlur,
        handleChange,
        maxLength,
        placeholder,
        type,
        value,
      ]
    )

    return (
      <AdminFormField
        {...(showFieldError(field) ? { error: showFieldError(field) } : {})}
        {...(hint ? { hint } : {})}
        label={label}
        {...(optional === undefined ? {} : { optional })}
      >
        {renderControl}
      </AdminFormField>
    )
  }
)

DiscographyTextField.displayName = "DiscographyTextField"

type ListFieldProps = {
  field: AnyFieldApi
  label: string
  placeholder: string
}

const DiscographyListField = memo<ListFieldProps>(
  ({ field, label, placeholder }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        const value = (event.currentTarget as unknown as { value?: unknown })
          .value
        field.handleChange(typeof value === "string" ? value : "")
      },
      [field]
    )
    const renderControl = useCallback(
      (control: AdminFormControlProps) => (
        <Textarea
          {...control}
          className="mt-2"
          maxLength={5_000}
          name={field.name}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={placeholder}
          rows={2}
          value={value}
        />
      ),
      [field.name, handleBlur, handleChange, placeholder, value]
    )

    return (
      <AdminFormField
        error={showFieldError(field)}
        hint="Separate values with commas or new lines. Duplicates are removed."
        label={label}
        optional
      >
        {renderControl}
      </AdminFormField>
    )
  }
)

DiscographyListField.displayName = "DiscographyListField"

const ReleaseTitleField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    label="Release title"
    maxLength={500}
    placeholder="Title only — keep the artist in its own field"
  />
)

const ArtistField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    label="Artist"
    maxLength={500}
    placeholder="Primary credited artist"
  />
)

const CollectionField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    label="Label or collection"
    maxLength={500}
    optional
  />
)

const CatalogNumberField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    label="Catalog number"
    maxLength={200}
    optional
    placeholder="Example: RR001"
  />
)

const CoverUrlField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    hint="Use a durable managed-media URL when artwork is available."
    label="Cover URL"
    maxLength={2_000}
    optional
    type="url"
  />
)

const CoverAltTextField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    hint="Describe meaningful artwork; leave empty when the cover is purely decorative."
    label="Cover description"
    maxLength={500}
    optional
  />
)

const FormatsField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    label="Formats"
    placeholder="Vinyl, CD, Cassette"
  />
)

const GenresField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    label="Genres"
    placeholder="Death metal, Doom"
  />
)

const TagsField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    label="Tags"
    placeholder="Demo, Compilation, Limited"
  />
)

const DatePrecisionField = (field: AnyFieldApi) => {
  const value =
    typeof field.state.value === "string" ? field.state.value : "unknown"
  return (
    <AdminFormField label="Date detail">
      {(control) => (
        <Select onValueChange={field.handleChange} value={value}>
          <Select.Trigger {...control} className="mt-2">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="day">Exact date</Select.Item>
            <Select.Item value="year">Year only</Select.Item>
            <Select.Item value="unknown">Not known</Select.Item>
          </Select.Content>
        </Select>
      )}
    </AdminFormField>
  )
}

const AvailabilityField = (field: AnyFieldApi) => {
  const value =
    typeof field.state.value === "string" ? field.state.value : "unknown"
  const labels: Record<(typeof discographyAvailabilityValues)[number], string> =
    {
      digital_only: "Digital only",
      in_print: "In print",
      out_of_print: "Out of print",
      preorder: "Pre-order",
      unknown: "Unknown",
    }
  return (
    <AdminFormField label="Availability">
      {(control) => (
        <Select onValueChange={field.handleChange} value={value}>
          <Select.Trigger {...control} className="mt-2">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {discographyAvailabilityValues.map((availability) => (
              <Select.Item key={availability} value={availability}>
                {labels[availability]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      )}
    </AdminFormField>
  )
}

const DateValueField = (field: AnyFieldApi) => {
  const values = field.form.state.values as DiscographyManualFormValues
  return (
    <DiscographyTextField
      field={field}
      label={values.datePrecision === "day" ? "Release date" : "Release year"}
      maxLength={10}
      {...(values.datePrecision === "year" ? { placeholder: "1999" } : {})}
      type={values.datePrecision === "day" ? "date" : "number"}
    />
  )
}

export type DiscographyManualFormProps = {
  entry?: DiscographyEntry
  error: string | null
  mode: "create" | "edit"
  onClose: () => void
  onSubmit: (
    values: ManualDiscographyInput,
    idempotencyKey: string
  ) => Promise<void>
  restoreFocusRef: RefObject<HTMLButtonElement | null>
}

export const DiscographyManualForm = memo<DiscographyManualFormProps>(
  ({ entry, error, mode, onClose, onSubmit, restoreFocusRef }) => {
    const idempotencyKeyRef = useRef(crypto.randomUUID())
    const lastSubmittedRef = useRef<string | null>(null)
    const form = useForm({
      defaultValues: entry ? valuesFromDiscographyEntry(entry) : emptyValues,
      onSubmit: async ({ value }) => {
        const serialized = JSON.stringify(value)
        if (
          lastSubmittedRef.current &&
          lastSubmittedRef.current !== serialized
        ) {
          idempotencyKeyRef.current = crypto.randomUUID()
        }
        lastSubmittedRef.current = serialized
        try {
          await onSubmit(
            buildManualDiscographyInput(value),
            idempotencyKeyRef.current
          )
        } catch {
          // The parent mutation renders the actionable request error in place.
        }
      },
      validators: { onChange: discographyManualFormSchema },
    })
    const state = useStore(form.store, (formState) => ({
      datePrecision: formState.values.datePrecision,
      isPristine: formState.isPristine,
      isSubmitting: formState.isSubmitting,
      values: formState.values,
    }))
    const formValid = useMemo(
      () => discographyManualFormSchema.safeParse(state.values).success,
      [state.values]
    )
    const busy = state.isSubmitting
    const handleSubmit = useCallback(() => form.handleSubmit(), [form])
    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open && !busy) {
          onClose()
        }
      },
      [busy, onClose]
    )
    const handleCloseAutoFocus = useCallback(
      (event: Event) => {
        event.preventDefault()
        const target = restoreFocusRef.current as unknown as {
          focus?: () => void
        } | null
        target?.focus?.()
      },
      [restoreFocusRef]
    )

    const fields = (
      <div className="flex flex-col gap-y-6">
        {error ? (
          <Alert role="alert" variant="error">
            <Text size="small">{error}</Text>
          </Alert>
        ) : null}

        <section aria-labelledby="discography-form-identity">
          <Heading id="discography-form-identity" level="h2">
            Release identity
          </Heading>
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            Historical records stay independent from Products and never create a
            storefront purchase link.
          </Text>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form.Field children={ReleaseTitleField} name="releaseTitle" />
            <form.Field children={ArtistField} name="artist" />
            <form.Field children={CollectionField} name="collectionTitle" />
            <form.Field children={CatalogNumberField} name="catalogNumber" />
          </div>
        </section>

        <section aria-labelledby="discography-form-release">
          <Heading id="discography-form-release" level="h2">
            Release details
          </Heading>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form.Field children={DatePrecisionField} name="datePrecision" />
            {state.datePrecision !== "unknown" ? (
              <form.Field children={DateValueField} name="dateValue" />
            ) : null}
            <form.Field children={AvailabilityField} name="availability" />
            <form.Field children={FormatsField} name="formatsText" />
            <form.Field children={GenresField} name="genresText" />
            <form.Field children={TagsField} name="tagsText" />
          </div>
        </section>

        <section aria-labelledby="discography-form-artwork">
          <Heading id="discography-form-artwork" level="h2">
            Artwork
          </Heading>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form.Field children={CoverUrlField} name="coverUrl" />
            <form.Field children={CoverAltTextField} name="coverAltText" />
          </div>
        </section>
      </div>
    )
    const saveDisabled =
      busy || !formValid || (mode === "edit" && state.isPristine)
    const footer = (
      <>
        <Button
          disabled={busy}
          onClick={onClose}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={saveDisabled}
          isLoading={busy}
          onClick={handleSubmit}
          type="button"
        >
          {mode === "create" ? "Add historical release" : "Save changes"}
        </Button>
      </>
    )

    if (mode === "edit") {
      return (
        <Drawer onOpenChange={handleOpenChange} open>
          <Drawer.Content onCloseAutoFocus={handleCloseAutoFocus}>
            <Drawer.Header>
              <Drawer.Title>Edit historical release</Drawer.Title>
              <Drawer.Description>
                Update this independent discography record. Store-linked
                releases remain managed from Products.
              </Drawer.Description>
            </Drawer.Header>
            <Drawer.Body className="overflow-y-auto">{fields}</Drawer.Body>
            <Drawer.Footer>{footer}</Drawer.Footer>
          </Drawer.Content>
        </Drawer>
      )
    }

    return (
      <FocusModal onOpenChange={handleOpenChange} open>
        <FocusModal.Content
          className="sm:inset-x-1/2 sm:inset-y-8 sm:w-full sm:max-w-4xl sm:-translate-x-1/2"
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <AdminFocusModalHeader
            description="Add a release that is part of the label history but is not sold as a current Product."
            title="Add historical release"
          />
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            {fields}
          </FocusModal.Body>
          <FocusModal.Footer>{footer}</FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    )
  }
)

DiscographyManualForm.displayName = "DiscographyManualForm"
