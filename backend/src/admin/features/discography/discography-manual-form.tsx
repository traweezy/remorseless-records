"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  AdminFormErrorSummary,
  AdminFormSaveState,
  AdminTaskNavigation,
  focusFirstAdminFormIssue,
  visibleAdminFormFieldError,
  useAdminUnsavedChanges,
  type AdminFormIssue,
  type AdminSaveState,
  type AdminTaskNavigationItem,
} from "../../components/admin-form-contract"
import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field"
import { ConfirmAction } from "../../components/confirm-action"
import {
  clearAdminFormDraft,
  readAdminFormDraft,
  writeAdminFormDraft,
} from "../../lib/admin-form-draft"
import {
  discographyAvailabilityValues,
  type DiscographyEntry,
  type ManualDiscographyInput,
} from "./discography-query"

const datePrecisionValues = ["day", "year", "unknown"] as const

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    (value) => value.length === 0 || isHttpUrl(value),
    "Enter a valid http or https URL."
  )

export const discographyManualDraftSchema = z.object({
  artist: z.string().trim().max(500),
  availability: z.enum(discographyAvailabilityValues),
  catalogNumber: z.string().trim().max(200),
  collectionTitle: z.string().trim().max(500),
  coverAltText: z.string().trim().max(500),
  coverUrl: z.string().trim().max(2_000),
  datePrecision: z.enum(datePrecisionValues),
  dateValue: z.string().trim().max(10),
  formatsText: z.string().max(5_000),
  genresText: z.string().max(5_000),
  releaseTitle: z.string().trim().max(500),
  tagsText: z.string().max(5_000),
})

export const discographyManualFormSchema = discographyManualDraftSchema
  .extend({
    artist: discographyManualDraftSchema.shape.artist.min(
      1,
      "Enter an artist."
    ),
    coverUrl: optionalUrlSchema,
    releaseTitle: discographyManualDraftSchema.shape.releaseTitle.min(
      1,
      "Enter a release title."
    ),
  })
  .superRefine((value, context) => {
    if (value.coverUrl && !value.coverAltText) {
      context.addIssue({
        code: "custom",
        message: "Describe the cover for screen-reader users.",
        path: ["coverAltText"],
      })
    }
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

export type DiscographyManualFormValues = z.infer<
  typeof discographyManualFormSchema
>

const discographyFieldTargets: Record<string, string> = {
  artist: "discography-artist",
  availability: "discography-availability-field",
  catalogNumber: "discography-catalog-number",
  collectionTitle: "discography-collection",
  coverAltText: "discography-cover-alt",
  coverUrl: "discography-cover-url",
  datePrecision: "discography-date-precision",
  dateValue: "discography-date-value",
  formatsText: "discography-formats",
  genresText: "discography-genres",
  releaseTitle: "discography-release-title",
  tagsText: "discography-tags",
}

export const discographyManualValidationIssues = (
  values: DiscographyManualFormValues
): AdminFormIssue[] => {
  const result = discographyManualFormSchema.safeParse(values)
  if (result.success) {
    return []
  }
  return result.error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "")
    return {
      key: `${issue.path.join(".")}:${issue.message}`,
      message: issue.message,
      targetId: discographyFieldTargets[field] ?? null,
    }
  })
}

const discographyTasks = [
  { href: "#discography-identity", label: "Release identity" },
  { href: "#discography-details", label: "Release details" },
  { href: "#discography-artwork", label: "Artwork" },
] as const satisfies readonly AdminTaskNavigationItem[]

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

export const discographyEntryMatchesManualInput = (
  entry: DiscographyEntry,
  input: ManualDiscographyInput
): boolean =>
  entry.artist === input.artist &&
  entry.availability === input.availability &&
  entry.catalogNumber === input.catalogNumber &&
  entry.collectionTitle === input.collectionTitle &&
  entry.coverAltText === input.coverAltText &&
  entry.coverUrl === input.coverUrl &&
  JSON.stringify(entry.formats) === JSON.stringify(input.formats) &&
  JSON.stringify(entry.genres) === JSON.stringify(input.genres) &&
  entry.releaseDate === input.releaseDate &&
  entry.releaseYear === input.releaseYear &&
  JSON.stringify(entry.tags) === JSON.stringify(input.tags) &&
  entry.title === input.releaseTitle

const discographyDraftStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const showFieldError = (field: AnyFieldApi): string | undefined =>
  visibleAdminFormFieldError({
    errors: field.state.meta.errors,
    isTouched: field.state.meta.isTouched,
    isValid: field.state.meta.isValid,
    submissionAttempts: field.form.state.submissionAttempts,
  })

type TextFieldProps = {
  field: AnyFieldApi
  hint?: string
  id?: string
  label: string
  maxLength: number
  optional?: boolean
  placeholder?: string
  type?: "date" | "number" | "text" | "url"
}

const DiscographyTextField = memo<TextFieldProps>(
  ({
    field,
    hint,
    id,
    label,
    maxLength,
    optional,
    placeholder,
    type = "text",
  }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        field.handleChange(event.currentTarget.value)
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
        {...(id ? { id } : {})}
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
  id: string
  label: string
  placeholder: string
}

const DiscographyListField = memo<ListFieldProps>(
  ({ field, id, label, placeholder }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        field.handleChange(event.currentTarget.value)
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
        id={id}
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
    id="discography-release-title"
    label="Release title"
    maxLength={500}
    placeholder="Title only — keep the artist in its own field"
  />
)

const ArtistField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    id="discography-artist"
    label="Artist"
    maxLength={500}
    placeholder="Primary credited artist"
  />
)

const CollectionField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    id="discography-collection"
    label="Label or collection"
    maxLength={500}
    optional
  />
)

const CatalogNumberField = (field: AnyFieldApi) => (
  <DiscographyTextField
    field={field}
    id="discography-catalog-number"
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
    id="discography-cover-url"
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
    id="discography-cover-alt"
    label="Cover description"
    maxLength={500}
    optional
  />
)

const FormatsField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    id="discography-formats"
    label="Formats"
    placeholder="Vinyl, CD, Cassette"
  />
)

const GenresField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    id="discography-genres"
    label="Genres"
    placeholder="Death metal, Doom"
  />
)

const TagsField = (field: AnyFieldApi) => (
  <DiscographyListField
    field={field}
    id="discography-tags"
    label="Tags"
    placeholder="Demo, Compilation, Limited"
  />
)

const DatePrecisionField = (field: AnyFieldApi) => {
  const value =
    typeof field.state.value === "string" ? field.state.value : "unknown"
  return (
    <AdminFormField id="discography-date-precision" label="Date detail">
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
    <AdminFormField id="discography-availability-field" label="Availability">
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
      id="discography-date-value"
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
    const draftKey = `admin:discography:${entry?.id ?? "new"}`
    const idempotencyKeyRef = useRef(crypto.randomUUID())
    const lastSubmittedRef = useRef<string | null>(null)
    const draftLoadedRef = useRef(false)
    const [discardOpen, setDiscardOpen] = useState(false)
    const [draftNotice, setDraftNotice] = useState<string | null>(null)
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
          const storage = discographyDraftStorage()
          if (storage) {
            clearAdminFormDraft({ key: draftKey, storage })
          }
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
      submissionAttempts: formState.submissionAttempts,
      values: formState.values,
    }))
    const busy = state.isSubmitting

    useEffect(() => {
      const storage = discographyDraftStorage()
      if (!storage) {
        draftLoadedRef.current = true
        return
      }
      const draft = readAdminFormDraft({
        key: draftKey,
        schema: discographyManualDraftSchema,
        storage,
      })
      if (draft) {
        form.reset(draft.values, { keepDefaultValues: true })
        setDraftNotice(
          `Recovered browser draft saved ${new Date(draft.savedAt).toLocaleString()}.`
        )
      }
      draftLoadedRef.current = true
    }, [draftKey, form])

    useEffect(() => {
      if (!draftLoadedRef.current || state.isPristine) {
        return undefined
      }
      const storage = discographyDraftStorage()
      if (!storage) {
        return undefined
      }
      const timer = setTimeout(() => {
        try {
          writeAdminFormDraft({
            key: draftKey,
            schema: discographyManualDraftSchema,
            storage,
            values: state.values,
          })
        } catch {
          setDraftNotice(
            "This browser could not save a recovery draft. Keep the editor open until the release is saved."
          )
        }
      }, 500)
      return () => clearTimeout(timer)
    }, [draftKey, state.isPristine, state.values])

    useAdminUnsavedChanges(!state.isPristine && !busy)

    const handleSubmit = useCallback(() => {
      void form.handleSubmit().finally(() => {
        const issues = discographyManualValidationIssues(form.state.values)
        if (issues.length > 0) {
          focusFirstAdminFormIssue(issues)
        }
      })
    }, [form])
    const requestClose = useCallback(() => {
      if (busy) {
        return
      }
      if (state.isPristine) {
        onClose()
        return
      }
      setDiscardOpen(true)
    }, [busy, onClose, state.isPristine])
    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open) {
          requestClose()
        }
      },
      [requestClose]
    )
    const cancelDiscard = useCallback(() => setDiscardOpen(false), [])
    const confirmDiscard = useCallback(() => {
      const storage = discographyDraftStorage()
      if (storage) {
        clearAdminFormDraft({ key: draftKey, storage })
      }
      setDiscardOpen(false)
      onClose()
    }, [draftKey, onClose])
    const handleCloseAutoFocus = useCallback(
      (event: Event) => {
        event.preventDefault()
        restoreFocusRef.current?.focus()
      },
      [restoreFocusRef]
    )

    const formIssues = useMemo<AdminFormIssue[]>(
      () => [
        ...(state.submissionAttempts > 0
          ? discographyManualValidationIssues(state.values)
          : []),
        ...(error
          ? [
              {
                key: `server:${error}`,
                message: error,
                targetId: null,
              },
            ]
          : []),
      ],
      [error, state.submissionAttempts, state.values]
    )
    const saveState: AdminSaveState = state.isSubmitting
      ? "saving"
      : error
        ? "error"
        : state.isPristine
          ? "idle"
          : "dirty"

    const fields = (
      <div className="flex flex-col gap-y-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text className="text-ui-fg-subtle" size="small">
              Add the identity first, then release details and artwork.
            </Text>
            <AdminFormSaveState state={saveState} />
          </div>
          <AdminTaskNavigation items={discographyTasks} />
          <AdminFormErrorSummary issues={formIssues} />
          {draftNotice ? (
            <Alert role="status" variant="info">
              <Text size="small">{draftNotice}</Text>
            </Alert>
          ) : null}
        </div>

        <section
          aria-labelledby="discography-form-identity"
          className="scroll-mt-24 outline-none"
          id="discography-identity"
          tabIndex={-1}
        >
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

        <section
          aria-labelledby="discography-form-release"
          className="scroll-mt-24 outline-none"
          id="discography-details"
          tabIndex={-1}
        >
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

        <section
          aria-labelledby="discography-form-artwork"
          className="scroll-mt-24 outline-none"
          id="discography-artwork"
          tabIndex={-1}
        >
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
    const saveDisabled = busy || (mode === "edit" && state.isPristine)
    const footer = (
      <>
        <Button
          disabled={busy}
          onClick={requestClose}
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
        <AdminFormSaveState className="order-first mr-auto" state={saveState} />
      </>
    )

    const editor =
      mode === "edit" ? (
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
      ) : (
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

    return (
      <>
        {editor}
        <ConfirmAction
          confirmLabel="Discard changes"
          description="Your unsaved release identity, details, and artwork changes will be lost."
          onCancel={cancelDiscard}
          onConfirm={confirmDiscard}
          open={discardOpen}
          title="Discard this historical release draft?"
          variant="danger"
        />
      </>
    )
  }
)

DiscographyManualForm.displayName = "DiscographyManualForm"
