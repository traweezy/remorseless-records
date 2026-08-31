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
  FocusModal,
  Heading,
  Input,
  StatusBadge,
  Text,
  Textarea,
} from "@medusajs/ui"

import { AdminFocusModalHeader } from "../../components/admin-focus-modal-header"
import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  AdminTaskNavigation,
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
import RichTextEditor from "../../components/rich-text-editor"
import {
  buildNewsWriteInput,
  emptyNewsEditorValues,
  newsEditorDraftSchema,
  newsEditorSchema,
  newsEditorValidationIssues,
  validatePublicationIntent,
  valuesFromNewsEntry,
  type NewsPublicationIntent,
} from "./news-form-state"
import { uploadNewsCover, validateNewsCover } from "./news-media-query"
import type { NewsEntry, NewsWriteInput } from "./news-query"

const showFieldError = (field: AnyFieldApi): string | undefined =>
  visibleAdminFormFieldError({
    errors: field.state.meta.errors,
    isTouched: field.state.meta.isTouched,
    isValid: field.state.meta.isValid,
    submissionAttempts: field.form.state.submissionAttempts,
  })

const newsEditorTasks = [
  { href: "#news-story", label: "Story" },
  { href: "#news-cover", label: "Cover" },
  { href: "#news-organization", label: "Tags" },
  { href: "#news-publishing", label: "Publishing" },
  { href: "#news-preview", label: "Preview" },
] as const satisfies readonly AdminTaskNavigationItem[]

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
        error={showFieldError(field)}
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

NewsTextField.displayName = "NewsTextField"

type TextareaFieldProps = {
  field: AnyFieldApi
  hint?: string
  id?: string
  label: string
  maxLength: number
  optional?: boolean
  placeholder?: string
  rows: number
}

const NewsTextareaField = memo<TextareaFieldProps>(
  ({ field, hint, id, label, maxLength, optional, placeholder, rows }) => {
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
          maxLength={maxLength}
          name={field.name}
          onBlur={handleBlur}
          onChange={handleChange}
          placeholder={placeholder}
          rows={rows}
          value={value}
        />
      ),
      [
        field.name,
        handleBlur,
        handleChange,
        maxLength,
        placeholder,
        rows,
        value,
      ]
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
  }
)

NewsTextareaField.displayName = "NewsTextareaField"

const TitleField = (field: AnyFieldApi) => (
  <NewsTextField
    field={field}
    id="news-title"
    label="Headline"
    maxLength={300}
    placeholder="A clear, specific update"
  />
)

const ExcerptField = (field: AnyFieldApi) => (
  <NewsTextareaField
    field={field}
    hint="Used on News cards and as the default search description."
    id="news-excerpt"
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
    id="news-tags"
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
    [field]
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
    [error, handleBlur, handleChange, value]
  )
  return (
    <AdminFormField error={error} id="news-content" label="Post body">
      {renderControl}
    </AdminFormField>
  )
})

NewsContentField.displayName = "NewsContentField"

const ContentField = (field: AnyFieldApi) => <NewsContentField field={field} />

type CoverFieldsProps = {
  altTextField: AnyFieldApi
  canUploadCover: boolean
  coverUrlField: AnyFieldApi
  onUploadingChange: (uploading: boolean) => void
}

const CoverFields = memo<CoverFieldsProps>(
  ({ altTextField, canUploadCover, coverUrlField, onUploadingChange }) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const uploadControllerRef = useRef<AbortController | null>(null)
    const mountedRef = useRef(true)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const coverUrl =
      typeof coverUrlField.state.value === "string"
        ? coverUrlField.state.value
        : ""
    const altText =
      typeof altTextField.state.value === "string"
        ? altTextField.state.value
        : ""
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
      if (!canUploadCover) {
        return
      }
      inputRef.current?.click()
    }, [canUploadCover])
    const handleUpload = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget
        const file = Array.from(input.files ?? [])[0]
        input.value = ""
        if (!canUploadCover || !file) {
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
                error instanceof Error
                  ? error.message
                  : "The cover could not be uploaded."
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
      [canUploadCover, coverUrlField, onUploadingChange]
    )
    const handleRemove = useCallback(() => {
      uploadControllerRef.current?.abort()
      coverUrlField.handleChange("")
      altTextField.handleChange("")
      setUploadError(null)
    }, [altTextField, coverUrlField])
    const handleAltBlur = useCallback(
      () => altTextField.handleBlur(),
      [altTextField]
    )
    const handleAltChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        altTextField.handleChange(event.currentTarget.value)
      },
      [altTextField]
    )

    return (
      <div className="space-y-4">
        <input
          accept="image/gif,image/jpeg,image/png,image/webp"
          aria-label="Upload news cover image"
          className="sr-only"
          disabled={!canUploadCover || uploading}
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
                id="news-cover-alt"
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
                {canUploadCover ? (
                  <Button
                    disabled={uploading}
                    onClick={handleChoose}
                    size="small"
                    type="button"
                    variant="secondary"
                  >
                    Replace cover
                  </Button>
                ) : null}
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
            <Text weight="plus">
              {canUploadCover ? "Add a cover image" : "Cover upload restricted"}
            </Text>
            <Text className="mt-1 text-ui-fg-subtle" size="small">
              {canUploadCover
                ? "JPEG, PNG, WebP, or non-animated GIF · 12 MiB maximum · metadata removed and saved as WebP"
                : "Your role can save this post but cannot upload files. Ask a super administrator for file creation access."}
            </Text>
            {canUploadCover ? (
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
            ) : null}
          </div>
        )}
        {uploadError ? (
          <Alert role="alert" variant="error">
            <Text size="small">{uploadError}</Text>
          </Alert>
        ) : null}
      </div>
    )
  }
)

CoverFields.displayName = "CoverFields"

type NewsEditorProps = {
  canUploadCover: boolean
  entry?: NewsEntry
  error: string | null
  mode: "create" | "edit"
  onClose: () => void
  onSubmit: (
    values: NewsWriteInput,
    idempotencyKey: string,
    intent: NewsPublicationIntent
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
  globalThis.requestAnimationFrame?.(() => {
    globalThis.document
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus()
  })
}

const focusSchedule = (): void => {
  globalThis.requestAnimationFrame?.(() => {
    globalThis.document?.getElementById("news-schedule-at")?.focus()
  })
}

const newsDraftStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const NewsEditor = memo<NewsEditorProps>(
  ({
    canUploadCover,
    entry,
    error,
    mode,
    onClose,
    onSubmit,
    restoreFocusRef,
  }) => {
    const draftKey = `admin:news:${entry?.id ?? "new"}`
    const idempotencyKeyRef = useRef(crypto.randomUUID())
    const lastSubmittedRef = useRef<string | null>(null)
    const intentRef = useRef<NewsPublicationIntent>("draft")
    const draftLoadedRef = useRef(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [draftNotice, setDraftNotice] = useState<string | null>(null)
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
        if (
          lastSubmittedRef.current &&
          lastSubmittedRef.current !== serialized
        ) {
          idempotencyKeyRef.current = crypto.randomUUID()
        }
        lastSubmittedRef.current = serialized
        setActionError(null)
        try {
          await onSubmit(
            buildNewsWriteInput(value, intent),
            idempotencyKeyRef.current,
            intent
          )
          const storage = newsDraftStorage()
          if (storage) {
            clearAdminFormDraft({ key: draftKey, storage })
          }
        } catch {
          // The parent mutation keeps the actionable error visible in this editor.
        }
      },
      validators: { onChange: newsEditorSchema },
    })
    const state = useStore(form.store, (formState) => ({
      isPristine: formState.isPristine,
      isSubmitting: formState.isSubmitting,
      submissionAttempts: formState.submissionAttempts,
      values: formState.values,
    }))
    const busy = state.isSubmitting || uploadingCover

    useEffect(() => {
      const storage = newsDraftStorage()
      if (!storage) {
        draftLoadedRef.current = true
        return
      }
      const draft = readAdminFormDraft({
        key: draftKey,
        schema: newsEditorDraftSchema,
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
      const storage = newsDraftStorage()
      if (!storage) {
        return undefined
      }
      const timer = setTimeout(() => {
        try {
          writeAdminFormDraft({
            key: draftKey,
            schema: newsEditorDraftSchema,
            storage,
            values: state.values,
          })
        } catch {
          setDraftNotice(
            "This browser could not save a recovery draft. Keep the editor open until the post is saved."
          )
        }
      }, 500)
      return () => clearTimeout(timer)
    }, [draftKey, state.isPristine, state.values])

    useAdminUnsavedChanges(!state.isPristine && !busy)
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
      [requestClose]
    )
    const cancelDiscard = useCallback(() => setDiscardOpen(false), [])
    const confirmDiscard = useCallback(() => {
      const storage = newsDraftStorage()
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
    const handleIntent = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        const intent = event.currentTarget.dataset.intent
        if (
          (intent !== "draft" &&
            intent !== "schedule" &&
            intent !== "publish") ||
          busy
        ) {
          return
        }
        intentRef.current = intent
        setActionError(null)
        void form.handleSubmit().finally(focusFirstInvalid)
      },
      [busy, form]
    )
    const handleUploadingChange = useCallback(
      (uploading: boolean) => setUploadingCover(uploading),
      []
    )
    const coverFields = useCallback(
      (coverUrlField: AnyFieldApi) => (
        <form.Field name="coverAltText">
          {(altTextField) => (
            <CoverFields
              altTextField={altTextField}
              canUploadCover={canUploadCover}
              coverUrlField={coverUrlField}
              onUploadingChange={handleUploadingChange}
            />
          )}
        </form.Field>
      ),
      [canUploadCover, form, handleUploadingChange]
    )

    const titlePreview = state.values.title.trim() || "Your headline"
    const descriptionPreview =
      state.values.excerpt.trim() ||
      "Add a short summary so readers and search engines understand this update."
    const routePreview = entry
      ? `/news/${entry.slug}`
      : "/news/generated-from-headline"
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
    const validationIssues = useMemo(
      () =>
        state.submissionAttempts > 0
          ? newsEditorValidationIssues(state.values)
          : [],
      [state.submissionAttempts, state.values]
    )
    const formIssues = useMemo<AdminFormIssue[]>(
      () => [
        ...validationIssues,
        ...(actionError
          ? [
              {
                key: `publication:${actionError}`,
                message: actionError,
                targetId: "news-schedule-at",
              },
            ]
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
      [actionError, error, validationIssues]
    )
    const saveState: AdminSaveState = state.isSubmitting
      ? "saving"
      : error || actionError
        ? "error"
        : state.isPristine
          ? "idle"
          : "dirty"

    return (
      <>
        <FocusModal onOpenChange={handleOpenChange} open>
          <FocusModal.Content
            className="sm:inset-x-1/2 sm:inset-y-4 sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:-translate-x-1/2"
            onCloseAutoFocus={handleCloseAutoFocus}
          >
            <AdminFocusModalHeader
              description="Write once, then save privately, schedule for later, or publish now."
              title={
                mode === "create"
                  ? "Create news post"
                  : `Edit ${entry?.title ?? "post"}`
              }
            />
            <FocusModal.Body
              aria-busy={busy}
              className="overflow-y-auto px-4 py-5 sm:px-6"
            >
              <div className="mb-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Text className="text-ui-fg-subtle" size="small">
                    Move through the story, media, organization, and publishing
                    tasks.
                  </Text>
                  <AdminFormSaveState state={saveState} />
                </div>
                <AdminTaskNavigation items={newsEditorTasks} />
                <AdminFormErrorSummary issues={formIssues} />
                {draftNotice ? (
                  <Alert role="status" variant="info">
                    <Text size="small">{draftNotice}</Text>
                  </Alert>
                ) : null}
              </div>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 space-y-8">
                  <section
                    aria-labelledby="news-story-heading"
                    className="scroll-mt-24 outline-none"
                    id="news-story"
                    tabIndex={-1}
                  >
                    <Heading id="news-story-heading" level="h2">
                      Story
                    </Heading>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Lead with the update readers need, then add the useful
                      context.
                    </Text>
                    <div className="mt-4 space-y-5">
                      <form.Field children={TitleField} name="title" />
                      <form.Field children={ExcerptField} name="excerpt" />
                      <form.Field children={ContentField} name="content" />
                    </div>
                  </section>

                  <section
                    aria-labelledby="news-cover-heading"
                    className="scroll-mt-24 outline-none"
                    id="news-cover"
                    tabIndex={-1}
                  >
                    <Heading id="news-cover-heading" level="h2">
                      Cover
                    </Heading>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Optional, but useful for the News feed and homepage
                      carousel.
                    </Text>
                    <div className="mt-4">
                      <form.Field children={coverFields} name="coverUrl" />
                    </div>
                  </section>

                  <section
                    aria-labelledby="news-tags-heading"
                    className="scroll-mt-24 outline-none"
                    id="news-organization"
                    tabIndex={-1}
                  >
                    <Heading id="news-tags-heading" level="h2">
                      Organization
                    </Heading>
                    <div className="mt-4">
                      <form.Field children={TagsField} name="tagsText" />
                    </div>
                  </section>
                </div>

                <aside className="space-y-6 lg:sticky lg:top-0 lg:self-start">
                  <section
                    aria-labelledby="news-publish-heading"
                    className="scroll-mt-24 rounded-lg border border-ui-border-base p-4 outline-none"
                    id="news-publishing"
                    tabIndex={-1}
                  >
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
                      Publishing makes the post visible immediately. Saving a
                      draft removes it from the storefront.
                    </Text>
                  </section>

                  <section
                    aria-labelledby="news-preview-heading"
                    className="scroll-mt-24 rounded-lg border border-ui-border-base p-4 outline-none"
                    id="news-preview"
                    tabIndex={-1}
                  >
                    <Heading id="news-preview-heading" level="h2">
                      Search preview
                    </Heading>
                    <Text
                      className="mt-3 break-words text-ui-fg-interactive"
                      size="xsmall"
                    >
                      {routePreview}
                    </Text>
                    <Text className="mt-2 break-words" weight="plus">
                      {titlePreview}
                    </Text>
                    <Text
                      className="mt-1 break-words text-ui-fg-subtle"
                      size="small"
                    >
                      {descriptionPreview}
                    </Text>
                    <Text className="mt-3 text-ui-fg-subtle" size="xsmall">
                      The public URL is generated when the post is first created
                      and remains stable after headline edits.
                    </Text>
                  </section>
                </aside>
              </div>
            </FocusModal.Body>
            <FocusModal.Footer className="flex-wrap gap-2">
              <AdminFormSaveState className="mr-auto" state={saveState} />
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
  }
)

NewsEditor.displayName = "NewsEditor"
