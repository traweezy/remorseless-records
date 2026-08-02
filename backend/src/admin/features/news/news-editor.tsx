"use client"

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react"
import { useForm, useStore, type AnyFieldApi } from "@tanstack/react-form"
import {
  Alert,
  Button,
  FocusModal,
  Heading,
  Input,
  StatusBadge,
  Text,
  Textarea,
} from "@medusajs/ui"

import { AdminFocusModalHeader } from "../../components/admin-focus-modal-header"
import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field"
import { ConfirmAction } from "../../components/confirm-action"
import RichTextEditor from "../../components/rich-text-editor"
import {
  buildNewsWriteInput,
  emptyNewsEditorValues,
  newsEditorSchema,
  validatePublicationIntent,
  valuesFromNewsEntry,
  type NewsEditorValues,
  type NewsPublicationIntent,
} from "./news-form-state"
import { uploadNewsCover, validateNewsCover } from "./news-media-query"
import type { NewsEntry, NewsWriteInput } from "./news-query"

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
  id?: string
  label: string
  maxLength: number
  optional?: boolean
  placeholder?: string
  type?: "datetime-local" | "text"
}

const NewsTextField = memo<TextFieldProps>(
  ({ field, hint, id, label, maxLength, optional, placeholder, type = "text" }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = (event.currentTarget as unknown as { value?: unknown }).value
        field.handleChange(typeof value === "string" ? value : "")
      },
      [field],
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
      [field.name, handleBlur, handleChange, maxLength, placeholder, type, value],
    )

    return (
      <AdminFormField
        error={showFieldError(field)}
        {...(hint ? { hint } : {})}
        {...(id ? { id } : {})}
        label={label}
        {...(optional === undefined ? {} : { optional })}
      >
        {renderControl}
      </AdminFormField>
    )
  },
)

NewsTextField.displayName = "NewsTextField"

type TextareaFieldProps = {
  field: AnyFieldApi
  hint?: string
  label: string
  maxLength: number
  optional?: boolean
  placeholder?: string
  rows: number
}

const NewsTextareaField = memo<TextareaFieldProps>(
  ({ field, hint, label, maxLength, optional, placeholder, rows }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        const value = (event.currentTarget as unknown as { value?: unknown }).value
        field.handleChange(typeof value === "string" ? value : "")
      },
      [field],
    )
    const renderControl = useCallback(
      (control: AdminFormControlProps) => (
        <Textarea
          {...control}
          className="mt-2"
          maxLength={maxLength}
          name={field.name}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={placeholder}
          rows={rows}
          value={value}
        />
      ),
      [field.name, handleBlur, handleChange, maxLength, placeholder, rows, value],
    )
    return (
      <AdminFormField
        error={showFieldError(field)}
        {...(hint ? { hint } : {})}
        label={label}
        {...(optional === undefined ? {} : { optional })}
      >
        {renderControl}
      </AdminFormField>
    )
  },
)

NewsTextareaField.displayName = "NewsTextareaField"

const TitleField = (field: AnyFieldApi) => (
  <NewsTextField
    field={field}
    label="Headline"
    maxLength={300}
    placeholder="A clear, specific update"
  />
)

const ExcerptField = (field: AnyFieldApi) => (
  <NewsTextareaField
    field={field}
    hint="Used on News cards and as the default search description."
    label="Summary"
    maxLength={1_000}
    optional
    placeholder="One or two sentences that help readers decide to open the post."
    rows={3}
  />
)

const TagsField = (field: AnyFieldApi) => (
  <NewsTextareaField
    field={field}
    hint="Separate tags with commas or new lines. Duplicates are removed."
    label="Tags"
    maxLength={5_000}
    optional
    placeholder="New release, Tour, Label update"
    rows={2}
  />
)

const ScheduleField = (field: AnyFieldApi) => (
  <NewsTextField
    field={field}
    hint="Uses your current local time and becomes visible automatically."
    id="news-schedule-at"
    label="Go live at"
    maxLength={100}
    optional
    type="datetime-local"
  />
)

type ContentFieldProps = {
  field: AnyFieldApi
}

const NewsContentField = memo<ContentFieldProps>(({ field }) => {
  const value = typeof field.state.value === "string" ? field.state.value : ""
  const error = showFieldError(field)
  const handleBlur = useCallback(() => field.handleBlur(), [field])
  const handleChange = useCallback(
    (nextValue: string) => field.handleChange(nextValue),
    [field],
  )
  const renderControl = useCallback(
    (control: AdminFormControlProps) => (
      <div className="mt-2">
        <RichTextEditor
          {...(control["aria-describedby"]
            ? { ariaDescribedBy: control["aria-describedby"] }
            : {})}
          ariaLabel="Post body"
          {...(error ? { error } : {})}
          id={control.id}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder="Tell readers what happened, why it matters, and what they can do next."
          value={value}
        />
      </div>
    ),
    [error, handleBlur, handleChange, value],
  )
  return (
    <AdminFormField error={error} label="Post body">
      {renderControl}
    </AdminFormField>
  )
})

NewsContentField.displayName = "NewsContentField"

const ContentField = (field: AnyFieldApi) => <NewsContentField field={field} />

type CoverFieldsProps = {
  altTextField: AnyFieldApi
  coverUrlField: AnyFieldApi
  onUploadingChange: (uploading: boolean) => void
}

const CoverFields = memo<CoverFieldsProps>(
  ({ altTextField, coverUrlField, onUploadingChange }) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadControllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const coverUrl =
    typeof coverUrlField.state.value === "string" ? coverUrlField.state.value : ""
  const altText =
    typeof altTextField.state.value === "string" ? altTextField.state.value : ""
  const altError = showFieldError(altTextField)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      uploadControllerRef.current?.abort()
      onUploadingChange(false)
    }
  }, [onUploadingChange])

  const handleChoose = useCallback(() => {
    const target = inputRef.current as unknown as { click?: () => void } | null
    target?.click?.()
  }, [])
  const handleUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget as unknown as {
        files?: ArrayLike<File> | null
        value: string
      }
      const file = Array.from(input.files ?? [])[0]
      input.value = ""
      if (!file) {
        return
      }
      const validationError = validateNewsCover(file)
      if (validationError) {
        setUploadError(validationError)
        return
      }
      const controller = new AbortController()
      uploadControllerRef.current?.abort()
      uploadControllerRef.current = controller
      setUploading(true)
      onUploadingChange(true)
      setUploadError(null)
      void uploadNewsCover(file, { signal: controller.signal })
        .then((url) => {
          if (mountedRef.current) {
            coverUrlField.handleChange(url)
            coverUrlField.handleBlur()
          }
        })
        .catch((error: unknown) => {
          if (mountedRef.current && !controller.signal.aborted) {
            setUploadError(
              error instanceof Error ? error.message : "The cover could not be uploaded.",
            )
          }
        })
        .finally(() => {
          if (uploadControllerRef.current === controller) {
            uploadControllerRef.current = null
            if (mountedRef.current) {
              setUploading(false)
              onUploadingChange(false)
            }
          }
        })
    },
    [coverUrlField, onUploadingChange],
  )
  const handleRemove = useCallback(() => {
    uploadControllerRef.current?.abort()
    coverUrlField.handleChange("")
    altTextField.handleChange("")
    setUploadError(null)
  }, [altTextField, coverUrlField])
  const handleAltBlur = useCallback(() => altTextField.handleBlur(), [altTextField])
  const handleAltChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = (event.currentTarget as unknown as { value?: unknown }).value
      altTextField.handleChange(typeof value === "string" ? value : "")
    },
    [altTextField],
  )

  return (
    <div className="space-y-4">
      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        aria-label="Upload news cover image"
        className="sr-only"
        disabled={uploading}
        onChange={handleUpload}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {coverUrl ? (
        <div className="grid gap-4 rounded-lg border border-ui-border-base p-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <img
            alt=""
            aria-hidden="true"
            className="h-32 w-32 rounded-md border border-ui-border-base object-cover"
            height="128"
            loading="lazy"
            src={coverUrl}
            width="128"
          />
          <div className="min-w-0">
            <AdminFormField
              error={altError}
              hint="Describe the meaningful subject or artwork without starting with “image of.”"
              label="Cover description"
            >
              {(control) => (
                <Input
                  {...control}
                  className="mt-2"
                  maxLength={500}
                  name={altTextField.name}
                  onBlur={handleAltBlur}
                  onChange={handleAltChange}
                  value={altText}
                />
              )}
            </AdminFormField>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={uploading}
                onClick={handleChoose}
                size="small"
                type="button"
                variant="secondary"
              >
                Replace cover
              </Button>
              <Button
                disabled={uploading}
                onClick={handleRemove}
                size="small"
                type="button"
                variant="secondary"
              >
                Remove cover
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ui-border-strong p-6 text-center">
          <Text weight="plus">Add a cover image</Text>
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            JPEG, PNG, WebP, or GIF · 12 MiB maximum
          </Text>
          <Button
            className="mt-4"
            disabled={uploading}
            isLoading={uploading}
            onClick={handleChoose}
            size="small"
            type="button"
            variant="secondary"
          >
            {uploading ? "Uploading…" : "Choose image"}
          </Button>
        </div>
      )}
      {uploadError ? (
        <Alert role="alert" variant="error">
          <Text size="small">{uploadError}</Text>
        </Alert>
      ) : null}
    </div>
  )
  },
)

CoverFields.displayName = "CoverFields"

type NewsEditorProps = {
  entry?: NewsEntry
  error: string | null
  mode: "create" | "edit"
  onClose: () => void
  onSubmit: (
    values: NewsWriteInput,
    idempotencyKey: string,
    intent: NewsPublicationIntent,
  ) => Promise<void>
  restoreFocusRef: RefObject<HTMLButtonElement | null>
}

const statusColor = {
  archived: "grey",
  draft: "grey",
  published: "green",
  scheduled: "orange",
} as const

const statusLabel = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
  scheduled: "Scheduled",
} as const

const focusFirstInvalid = (): void => {
  const browser = globalThis as unknown as {
    document?: {
      querySelector: (selector: string) => { focus?: () => void } | null
    }
    requestAnimationFrame?: (callback: () => void) => number
  }
  browser.requestAnimationFrame?.(() => {
    browser.document?.querySelector('[aria-invalid="true"]')?.focus?.()
  })
}

const focusSchedule = (): void => {
  const browser = globalThis as unknown as {
    document?: {
      getElementById: (id: string) => { focus?: () => void } | null
    }
    requestAnimationFrame?: (callback: () => void) => number
  }
  browser.requestAnimationFrame?.(() => {
    browser.document?.getElementById("news-schedule-at")?.focus?.()
  })
}

export const NewsEditor = memo<NewsEditorProps>(
  ({ entry, error, mode, onClose, onSubmit, restoreFocusRef }) => {
    const idempotencyKeyRef = useRef(crypto.randomUUID())
    const lastSubmittedRef = useRef<string | null>(null)
    const intentRef = useRef<NewsPublicationIntent>("draft")
    const [actionError, setActionError] = useState<string | null>(null)
    const [discardOpen, setDiscardOpen] = useState(false)
    const [uploadingCover, setUploadingCover] = useState(false)
    const form = useForm({
      defaultValues: entry ? valuesFromNewsEntry(entry) : emptyNewsEditorValues,
      onSubmit: async ({ value }) => {
        const intent = intentRef.current
        const publicationError = validatePublicationIntent(value, intent)
        if (publicationError) {
          setActionError(publicationError)
          focusSchedule()
          return
        }
        const serialized = JSON.stringify({ intent, value })
        if (lastSubmittedRef.current && lastSubmittedRef.current !== serialized) {
          idempotencyKeyRef.current = crypto.randomUUID()
        }
        lastSubmittedRef.current = serialized
        setActionError(null)
        try {
          await onSubmit(
            buildNewsWriteInput(value, intent),
            idempotencyKeyRef.current,
            intent,
          )
        } catch {
          // The parent mutation keeps the actionable error visible in this editor.
        }
      },
      validators: { onChange: newsEditorSchema },
    })
    const state = useStore(form.store, (formState) => ({
      isPristine: formState.isPristine,
      isSubmitting: formState.isSubmitting,
      values: formState.values,
    }))
    const busy = state.isSubmitting || uploadingCover
    const requestClose = useCallback(() => {
      if (busy) {
        return
      }
      if (state.isPristine) {
        onClose()
      } else {
        setDiscardOpen(true)
      }
    }, [busy, onClose, state.isPristine])
    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open) {
          requestClose()
        }
      },
      [requestClose],
    )
    const cancelDiscard = useCallback(() => setDiscardOpen(false), [])
    const confirmDiscard = useCallback(() => {
      setDiscardOpen(false)
      onClose()
    }, [onClose])
    const handleCloseAutoFocus = useCallback(
      (event: Event) => {
        event.preventDefault()
        const target = restoreFocusRef.current as unknown as { focus?: () => void } | null
        target?.focus?.()
      },
      [restoreFocusRef],
    )
    const handleIntent = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        const intent = (
          event.currentTarget as unknown as {
            dataset: { intent?: NewsPublicationIntent }
          }
        ).dataset.intent
        if (!intent || busy) {
          return
        }
        intentRef.current = intent
        setActionError(null)
        void form.handleSubmit().finally(focusFirstInvalid)
      },
      [busy, form],
    )
    const handleUploadingChange = useCallback(
      (uploading: boolean) => setUploadingCover(uploading),
      [],
    )
    const coverFields = useCallback(
      (coverUrlField: AnyFieldApi) => (
        <form.Field name="coverAltText">
          {(altTextField) => (
            <CoverFields
              altTextField={altTextField}
              coverUrlField={coverUrlField}
              onUploadingChange={handleUploadingChange}
            />
          )}
        </form.Field>
      ),
      [form, handleUploadingChange],
    )

    const titlePreview = state.values.title.trim() || "Your headline"
    const descriptionPreview =
      state.values.excerpt.trim() ||
      "Add a short summary so readers and search engines understand this update."
    const routePreview = entry ? `/news/${entry.slug}` : "/news/generated-from-headline"
    const currentStatus = entry?.status ?? "draft"
    const primaryLabel = mode === "create" ? "Publish now" : "Publish changes"
    const draftLabel =
      entry?.status === "published" || entry?.status === "scheduled"
        ? "Move to draft"
        : "Save draft"
    const draftUnchanged =
      mode === "edit" && currentStatus === "draft" && state.isPristine
    const scheduleUnchanged =
      mode === "edit" && currentStatus === "scheduled" && state.isPristine
    const publishUnchanged =
      mode === "edit" && currentStatus === "published" && state.isPristine

    return (
      <>
        <FocusModal onOpenChange={handleOpenChange} open>
          <FocusModal.Content
            className="sm:inset-x-1/2 sm:inset-y-4 sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:-translate-x-1/2"
            onCloseAutoFocus={handleCloseAutoFocus}
          >
            <AdminFocusModalHeader
              description="Write once, then save privately, schedule for later, or publish now."
              title={mode === "create" ? "Create news post" : `Edit ${entry?.title ?? "post"}`}
            />
            <FocusModal.Body className="overflow-y-auto px-4 py-5 sm:px-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-8">
                  {error || actionError ? (
                    <Alert role="alert" variant="error">
                      <Text size="small">{actionError ?? error}</Text>
                    </Alert>
                  ) : null}

                  <section aria-labelledby="news-story-heading">
                    <Heading id="news-story-heading" level="h2">
                      Story
                    </Heading>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Lead with the update readers need, then add the useful context.
                    </Text>
                    <div className="mt-4 space-y-5">
                      <form.Field children={TitleField} name="title" />
                      <form.Field children={ExcerptField} name="excerpt" />
                      <form.Field children={ContentField} name="content" />
                    </div>
                  </section>

                  <section aria-labelledby="news-cover-heading">
                    <Heading id="news-cover-heading" level="h2">
                      Cover
                    </Heading>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Optional, but useful for the News feed and homepage carousel.
                    </Text>
                    <div className="mt-4">
                      <form.Field children={coverFields} name="coverUrl" />
                    </div>
                  </section>

                  <section aria-labelledby="news-tags-heading">
                    <Heading id="news-tags-heading" level="h2">
                      Organization
                    </Heading>
                    <div className="mt-4">
                      <form.Field children={TagsField} name="tagsText" />
                    </div>
                  </section>
                </div>

                <aside className="space-y-6 lg:sticky lg:top-0 lg:self-start">
                  <section className="rounded-lg border border-ui-border-base p-4" aria-labelledby="news-publish-heading">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Heading id="news-publish-heading" level="h2">
                        Publishing
                      </Heading>
                      <StatusBadge color={statusColor[currentStatus]}>
                        {statusLabel[currentStatus]}
                      </StatusBadge>
                    </div>
                    {entry?.author ? (
                      <Text className="mt-3 text-ui-fg-subtle" size="small">
                        Written by {entry.author}
                      </Text>
                    ) : (
                      <Text className="mt-3 text-ui-fg-subtle" size="small">
                        The signed-in administrator is recorded as the author.
                      </Text>
                    )}
                    <div className="mt-4">
                      <form.Field children={ScheduleField} name="scheduleAt" />
                    </div>
                    <Text className="mt-4 text-ui-fg-subtle" size="xsmall">
                      Publishing makes the post visible immediately. Saving a draft removes it from the storefront.
                    </Text>
                  </section>

                  <section className="rounded-lg border border-ui-border-base p-4" aria-labelledby="news-preview-heading">
                    <Heading id="news-preview-heading" level="h2">
                      Search preview
                    </Heading>
                    <Text className="mt-3 break-words text-ui-fg-interactive" size="xsmall">
                      {routePreview}
                    </Text>
                    <Text className="mt-2 break-words" weight="plus">
                      {titlePreview}
                    </Text>
                    <Text className="mt-1 break-words text-ui-fg-subtle" size="small">
                      {descriptionPreview}
                    </Text>
                    <Text className="mt-3 text-ui-fg-subtle" size="xsmall">
                      The public URL is generated when the post is first created and remains stable after headline edits.
                    </Text>
                  </section>
                </aside>
              </div>
            </FocusModal.Body>
            <FocusModal.Footer className="flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={requestClose}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                data-intent="draft"
                disabled={busy || draftUnchanged}
                onClick={handleIntent}
                type="button"
                variant="secondary"
              >
                {draftLabel}
              </Button>
              <Button
                data-intent="schedule"
                disabled={busy || scheduleUnchanged}
                onClick={handleIntent}
                type="button"
                variant="secondary"
              >
                Schedule
              </Button>
              <Button
                data-intent="publish"
                disabled={busy || publishUnchanged}
                isLoading={busy}
                onClick={handleIntent}
                type="button"
              >
                {primaryLabel}
              </Button>
              <div aria-live="polite" className="sr-only">
                {busy ? "Saving news post" : ""}
              </div>
            </FocusModal.Footer>
          </FocusModal.Content>
        </FocusModal>

        <ConfirmAction
          confirmLabel="Discard changes"
          description="Your unsaved headline, story, cover, scheduling, and tag changes will be lost."
          onCancel={cancelDiscard}
          onConfirm={confirmDiscard}
          open={discardOpen}
          title="Discard this draft?"
          variant="danger"
        />
      </>
    )
  },
)

NewsEditor.displayName = "NewsEditor"
