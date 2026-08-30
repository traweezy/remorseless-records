"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react"
import { useForm, useStore, type AnyFieldApi } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Skeleton,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  focusFirstAdminFormIssue,
  runRecoverableAdminMutation,
  useAdminUnsavedChanges,
  visibleAdminFormFieldError,
  type AdminFormIssue,
  type AdminSaveState,
} from "../../components/admin-form-contract"
import {
  AdminFormField,
  type AdminFormControlProps,
} from "../../components/admin-form-field"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { AdminRetryState } from "../../components/admin-retry-state"
import { ConfirmAction } from "../../components/confirm-action"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import { catalogVariantProfileActions } from "../catalog-permissions"
import {
  buildVariantCatalogProfilePayload,
  deriveVariantCatalogLabel,
  deriveVariantCustomerState,
  isFutureCatalogDate,
  variantCatalogProfileFormSchema,
  variantCatalogProfileValues,
  variantCatalogProfileWasApplied,
  variantNativeLabel,
  variantStockSummary,
  type VariantCatalogProfileFormValues,
  type VariantCatalogWidgetData,
  type VariantMetadataLine,
} from "./variant-catalog-profile-form"
import {
  loadVariantCatalogProfile,
  saveVariantCatalogProfile,
  variantCatalogProfileQueryKey,
  variantCatalogProfileQueryOptions,
  type CatalogReferenceValue,
  type VariantCatalogProfileData,
} from "./variant-catalog-profile-query"

type VariantCatalogProfileWidgetProps = {
  data?: VariantCatalogWidgetData
}

const emptyValues = (): VariantCatalogProfileFormValues =>
  variantCatalogProfileValues(null)

const readValue = (
  event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
): string => {
  const value = (event.currentTarget as unknown as { value?: unknown }).value
  return typeof value === "string" ? value : ""
}

const fieldError = (field: AnyFieldApi): string | undefined =>
  visibleAdminFormFieldError({
    errors: field.state.meta.errors,
    isTouched: field.state.meta.isTouched,
    isValid: field.state.meta.isValid,
    submissionAttempts: field.form.state.submissionAttempts,
  })

type VariantTextFieldProps = {
  field: AnyFieldApi
  hint: string
  id: string
  label: string
  list?: string
  multiline?: boolean
  placeholder?: string
}

const VariantTextField = memo<VariantTextFieldProps>(
  ({ field, hint, id, label, list, multiline = false, placeholder }) => {
    const value = typeof field.state.value === "string" ? field.state.value : ""
    const handleBlur = useCallback(() => field.handleBlur(), [field])
    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        field.handleChange(readValue(event))
      },
      [field]
    )
    const renderControl = useCallback(
      (controlProps: AdminFormControlProps) =>
        multiline ? (
          <Textarea
            {...controlProps}
            className="mt-2"
            maxLength={500}
            name={field.name}
            onBlur={handleBlur}
            onChange={handleChange}
            placeholder={placeholder}
            rows={3}
            value={value}
          />
        ) : (
          <Input
            {...controlProps}
            className="mt-2"
            list={list}
            name={field.name}
            onBlur={handleBlur}
            onChange={handleChange}
            placeholder={placeholder}
            value={value}
          />
        ),
      [
        field.name,
        handleBlur,
        handleChange,
        list,
        multiline,
        placeholder,
        value,
      ]
    )
    return (
      <AdminFormField
        error={fieldError(field)}
        hint={hint}
        id={id}
        label={label}
        optional={id !== "variant-catalog-format"}
      >
        {renderControl}
      </AdminFormField>
    )
  }
)

VariantTextField.displayName = "VariantTextField"

type VariantSwitchFieldProps = {
  description: string
  field: AnyFieldApi
  label: string
}

const VariantSwitchField = memo<VariantSwitchFieldProps>(
  ({ description, field, label }) => {
    const checked = field.state.value === true
    const handleChange = useCallback(
      (value: boolean) => field.handleChange(value),
      [field]
    )
    return (
      <div className="flex items-center justify-between gap-4 rounded-md border border-ui-border-base p-4">
        <div className="min-w-0">
          <Text weight="plus">{label}</Text>
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            {description}
          </Text>
        </div>
        <Switch
          aria-label={label}
          checked={checked}
          onCheckedChange={handleChange}
        />
      </div>
    )
  }
)

VariantSwitchField.displayName = "VariantSwitchField"

type MetadataTarget = {
  dataset?: Record<string, string | undefined>
  name?: string
  value?: string
}

const metadataTarget = (event: {
  currentTarget: EventTarget
}): MetadataTarget => event.currentTarget as unknown as MetadataTarget

type VariantMetadataEditorProps = {
  field: AnyFieldApi
  issues: readonly AdminFormIssue[]
}

const VariantMetadataEditor = memo<VariantMetadataEditorProps>(
  ({ field, issues }) => {
    const lines = Array.isArray(field.state.value)
      ? (field.state.value as VariantMetadataLine[])
      : []
    const updateLines = useCallback(
      (next: VariantMetadataLine[]) => field.handleChange(next),
      [field]
    )
    const addLine = useCallback(() => {
      updateLines([...lines, { id: crypto.randomUUID(), name: "", value: "" }])
    }, [lines, updateLines])
    const updateLine = useCallback(
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const target = metadataTarget(event)
        const lineId = target.dataset?.lineId
        const name = target.name as "name" | "value" | undefined
        if (!lineId || !name) {
          return
        }
        updateLines(
          lines.map((line) =>
            line.id === lineId ? { ...line, [name]: target.value ?? "" } : line
          )
        )
      },
      [lines, updateLines]
    )
    const removeLine = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        const lineId = metadataTarget(event).dataset?.lineId
        if (lineId) {
          updateLines(lines.filter((line) => line.id !== lineId))
        }
      },
      [lines, updateLines]
    )
    const rows = useMemo(
      () =>
        lines.map((line) => {
          const lineIssue = issues.find(
            (issue) => issue.targetId === `variant-metadata-${line.id}-name`
          )
          return (
            <div
              className="grid gap-3 rounded-md border border-ui-border-base p-3 sm:grid-cols-[minmax(0,1fr),minmax(0,2fr),auto]"
              key={line.id}
            >
              <AdminFormField
                error={lineIssue?.message}
                id={`variant-metadata-${line.id}-name`}
                label="Field name"
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    className="mt-2"
                    data-line-id={line.id}
                    name="name"
                    onChange={updateLine}
                    value={line.name}
                  />
                )}
              </AdminFormField>
              <AdminFormField
                id={`variant-metadata-${line.id}-value`}
                label="Value"
              >
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    className="mt-2"
                    data-line-id={line.id}
                    name="value"
                    onChange={updateLine}
                    rows={2}
                    value={line.value}
                  />
                )}
              </AdminFormField>
              <div className="flex items-end">
                <Button
                  aria-label={`Remove ${line.name || "advanced field"}`}
                  data-line-id={line.id}
                  onClick={removeLine}
                  type="button"
                  variant="secondary"
                >
                  Remove
                </Button>
              </div>
            </div>
          )
        }),
      [issues, lines, removeLine, updateLine]
    )
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Text className="max-w-xl text-ui-fg-subtle" size="small">
            Use only for structured facts that have no ordinary field. JSON
            values are accepted; plain text stays plain text.
          </Text>
          <Button
            onClick={addLine}
            size="small"
            type="button"
            variant="secondary"
          >
            Add advanced field
          </Button>
        </div>
        {rows.length > 0 ? (
          <div className="space-y-3">{rows}</div>
        ) : (
          <Text className="text-ui-fg-subtle" size="small">
            No advanced fields.
          </Text>
        )}
      </div>
    )
  }
)

VariantMetadataEditor.displayName = "VariantMetadataEditor"

const variantFormIssues = (
  values: VariantCatalogProfileFormValues
): AdminFormIssue[] => {
  const result = variantCatalogProfileFormSchema.safeParse(values)
  if (result.success) {
    return []
  }
  return result.error.issues.map((issue) => {
    const field = issue.path[0]
    const lineIndex = issue.path[1]
    const line =
      field === "metadata" && typeof lineIndex === "number"
        ? values.metadata[lineIndex]
        : undefined
    const targetId = line
      ? `variant-metadata-${line.id}-name`
      : field === "format"
        ? "variant-catalog-format"
        : field === "formatDetail"
          ? "variant-catalog-format-detail"
          : field === "customerNote"
            ? "variant-catalog-customer-note"
            : field === "imageUrl"
              ? "variant-catalog-image-url"
              : null
    return {
      key: `${issue.path.join(".")}:${issue.message}`,
      message: issue.message,
      targetId,
    }
  })
}

const SummaryItem = memo<{ label: string; value: string }>(
  ({ label, value }) => (
    <div>
      <Text className="text-ui-fg-subtle" size="xsmall">
        {label}
      </Text>
      <Text className="mt-1" size="small" weight="plus">
        {value}
      </Text>
    </div>
  )
)

SummaryItem.displayName = "SummaryItem"

const releaseDateLabel = (value: string | null | undefined): string => {
  if (!value) {
    return "Not set"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Needs review"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date)
}

const requestFocusFirstIssue = (issues: readonly AdminFormIssue[]): void => {
  const browser = globalThis as unknown as {
    requestAnimationFrame?: (callback: () => void) => number
  }
  if (browser.requestAnimationFrame) {
    browser.requestAnimationFrame(() => focusFirstAdminFormIssue(issues))
    return
  }
  focusFirstAdminFormIssue(issues)
}

const VariantCatalogProfileWidgetContent =
  memo<VariantCatalogProfileWidgetProps>(({ data }) => {
    const variantId = data?.id ?? ""
    const productId = data?.product_id?.trim() || null
    const queryClient = useQueryClient()
    const queryOptions = useMemo(
      () => variantCatalogProfileQueryOptions(variantId, productId),
      [productId, variantId]
    )
    const query = useQuery({ ...queryOptions, enabled: Boolean(variantId) })
    const [open, setOpen] = useState(false)
    const [discardOpen, setDiscardOpen] = useState(false)
    const [issues, setIssues] = useState<AdminFormIssue[]>([])
    const defaultValues = useMemo(emptyValues, [])

    const mutation = useMutation({
      mutationFn: async ({
        expectedVersion,
        values,
      }: {
        expectedVersion: number
        values: VariantCatalogProfileFormValues
      }) => {
        if (!variantId || !query.data) {
          throw new Error("Variant catalog data is unavailable.")
        }
        const payload = buildVariantCatalogProfilePayload({
          productId,
          references: query.data.references,
          values,
        })
        const result = await runRecoverableAdminMutation({
          mutate: () =>
            saveVariantCatalogProfile({
              expectedVersion,
              idempotencyKey: crypto.randomUUID(),
              payload,
              variantId,
            }),
          readAfterFailure: () =>
            loadVariantCatalogProfile({ productId, variantId }),
          wasApplied: (snapshot) =>
            (snapshot.profile?.version ?? 0) > expectedVersion &&
            variantCatalogProfileWasApplied({
              profile: snapshot.profile,
              values,
            }),
        })
        const nextData: VariantCatalogProfileData =
          result.outcome === "reconciled"
            ? result.value
            : { ...query.data, profile: result.value }
        return { nextData, reconciled: result.outcome === "reconciled" }
      },
    })

    const form = useForm({
      defaultValues,
      onSubmit: async ({ value }) => {
        const parsed = variantCatalogProfileFormSchema.parse(value)
        try {
          const result = await mutation.mutateAsync({
            expectedVersion: query.data?.profile?.version ?? 0,
            values: parsed,
          })
          queryClient.setQueryData(
            variantCatalogProfileQueryKey(variantId, productId),
            result.nextData
          )
          form.reset(variantCatalogProfileValues(result.nextData.profile), {
            keepDefaultValues: true,
          })
          setIssues([])
          setOpen(false)
          toast.success(
            result.reconciled
              ? "Saved variant profile; confirmed after checking the server"
              : "Saved variant catalog profile"
          )
        } catch {
          // The mutation state renders the safe actionable error below.
        }
      },
      validators: {
        onBlur: variantCatalogProfileFormSchema,
        onChange: variantCatalogProfileFormSchema,
      },
    })
    const formState = useStore(form.store, (state) => ({
      isDirty: state.isDirty,
      isPristine: state.isPristine,
      isSubmitting: state.isSubmitting,
      values: state.values,
    }))

    useEffect(() => {
      if (query.data && !open) {
        form.reset(variantCatalogProfileValues(query.data.profile), {
          keepDefaultValues: true,
        })
      }
    }, [form, open, query.data])

    useAdminUnsavedChanges(open && formState.isDirty)

    const requestClose = useCallback(() => {
      if (formState.isDirty) {
        setDiscardOpen(true)
        return
      }
      setOpen(false)
    }, [formState.isDirty])
    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        if (nextOpen) {
          mutation.reset()
          setIssues([])
          setOpen(true)
          return
        }
        requestClose()
      },
      [mutation, requestClose]
    )
    const handleEdit = useCallback(() => {
      mutation.reset()
      setIssues([])
      if (query.data) {
        form.reset(variantCatalogProfileValues(query.data.profile), {
          keepDefaultValues: true,
        })
      }
      setOpen(true)
    }, [form, mutation, query.data])
    const handleDiscardCancel = useCallback(() => setDiscardOpen(false), [])
    const handleDiscardConfirm = useCallback(() => {
      if (query.data) {
        form.reset(variantCatalogProfileValues(query.data.profile), {
          keepDefaultValues: true,
        })
      }
      mutation.reset()
      setIssues([])
      setDiscardOpen(false)
      setOpen(false)
    }, [form, mutation, query.data])
    const handleRetryLoad = useCallback(() => {
      void query.refetch()
    }, [query])
    const handleSave = useCallback(() => {
      const nextIssues = variantFormIssues(form.state.values)
      setIssues(nextIssues)
      if (nextIssues.length > 0) {
        requestFocusFirstIssue(nextIssues)
        return
      }
      void form.handleSubmit()
    }, [form])

    const renderFormat = useCallback(
      (field: AnyFieldApi) => (
        <VariantTextField
          field={field}
          hint="Choose an existing format when possible; a new choice is created safely when needed."
          id="variant-catalog-format"
          label="Customer-facing format"
          list="catalog-reference-format"
          placeholder="Vinyl"
        />
      ),
      []
    )
    const renderFormatDetail = useCallback(
      (field: AnyFieldApi) => (
        <VariantTextField
          field={field}
          hint="Color, pressing, size, or another detail customers use to distinguish this option."
          id="variant-catalog-format-detail"
          label="Format detail"
          list="catalog-reference-format-detail"
          placeholder="Black"
        />
      ),
      []
    )
    const renderCustomerNote = useCallback(
      (field: AnyFieldApi) => (
        <VariantTextField
          field={field}
          hint="Shown only when preorder or backorder messaging needs clarification."
          id="variant-catalog-customer-note"
          label="Customer availability note"
          multiline
        />
      ),
      []
    )
    const renderImageUrl = useCallback(
      (field: AnyFieldApi) => (
        <VariantTextField
          field={field}
          hint="Prefer managed product media. Use this only when this option needs a distinct image."
          id="variant-catalog-image-url"
          label="Variant image URL"
          placeholder="https://…"
        />
      ),
      []
    )
    const renderPreorder = useCallback(
      (field: AnyFieldApi) => (
        <VariantSwitchField
          description="Allow purchase before a future product release date. Without this, customers see Coming soon."
          field={field}
          label="Available for preorder"
        />
      ),
      []
    )
    const renderBackorder = useCallback(
      (field: AnyFieldApi) => (
        <VariantSwitchField
          description="Show backorder messaging at zero stock. Native Medusa Allow backorders remains the checkout authority."
          field={field}
          label="Backorder eligible at zero stock"
        />
      ),
      []
    )
    const renderMetadata = useCallback(
      (field: AnyFieldApi) => (
        <VariantMetadataEditor field={field} issues={issues} />
      ),
      [issues]
    )

    if (!variantId) {
      return null
    }

    const values = formState.values
    const derivedLabel = deriveVariantCatalogLabel(
      values.format,
      values.formatDetail
    )
    const releaseDate = query.data?.releaseDate ?? null
    const releaseIsFuture = isFutureCatalogDate(releaseDate)
    const customerState = deriveVariantCustomerState({
      backorderAllowed: values.backorderAllowed,
      nativeBackorderAllowed: Boolean(data?.allow_backorder),
      preorderAllowed: values.preorderAllowed,
      releaseDate,
      variant: data,
    })
    const saveState: AdminSaveState =
      mutation.isPending || formState.isSubmitting
        ? "saving"
        : mutation.isError
          ? "error"
          : formState.isDirty
            ? "dirty"
            : query.data?.profile
              ? "saved"
              : "idle"
    const formatReferences = (query.data?.references ?? []).filter(
      (reference) => reference.kind === "format"
    )
    const detailReferences = (query.data?.references ?? []).filter(
      (reference) => reference.kind === "format_detail"
    )

    return (
      <>
        <Container className="divide-y divide-ui-border-base p-0">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
            <div className="min-w-0">
              <Heading level="h2">Catalog variant profile</Heading>
              <Text className="mt-1 text-ui-fg-subtle" size="small">
                Customer-facing format and availability. Prices, inventory, and
                fulfillment stay in Medusa’s native variant forms.
              </Text>
            </div>
            <Button
              disabled={query.isPending || query.isError}
              onClick={handleEdit}
              size="small"
              type="button"
              variant="secondary"
            >
              Edit catalog variant
            </Button>
          </div>
          {query.isError ? (
            <div className="px-6 py-4">
              <AdminRetryState
                message={getAdminRequestErrorMessage(
                  query.error,
                  "The variant catalog profile could not be loaded."
                )}
                onRetry={handleRetryLoad}
                retrying={query.isFetching}
                title="Variant profile unavailable"
              />
            </div>
          ) : query.isPending ? (
            <div
              aria-busy="true"
              aria-label="Loading variant catalog profile"
              className="grid gap-4 px-6 py-4 md:grid-cols-2"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton className="h-12" key={index} />
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-4 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
                <SummaryItem
                  label="Native variant"
                  value={variantNativeLabel(data)}
                />
                <SummaryItem label="Storefront label" value={derivedLabel} />
                <SummaryItem
                  label="Customer state"
                  value={customerState.label}
                />
                <SummaryItem
                  label="Why customers see it"
                  value={customerState.description}
                />
                <SummaryItem
                  label="Native stock evidence"
                  value={variantStockSummary(data)}
                />
                <SummaryItem
                  label="Product release date"
                  value={releaseDateLabel(releaseDate)}
                />
              </div>
              <div className="flex flex-wrap gap-2 px-6 py-4">
                <Badge color={query.data?.profile ? "blue" : "orange"}>
                  {query.data?.profile
                    ? "Catalog data saved"
                    : "Catalog data incomplete"}
                </Badge>
                <Badge color="grey">Display label is derived</Badge>
                {values.preorderAllowed ? (
                  <Badge color={releaseIsFuture ? "blue" : "orange"}>
                    {releaseIsFuture
                      ? "Preorder eligible"
                      : "Set a future release date"}
                  </Badge>
                ) : null}
              </div>
            </>
          )}
        </Container>

        <Drawer onOpenChange={handleOpenChange} open={open}>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title>Edit catalog variant</Drawer.Title>
              <Drawer.Description>
                Update the customer-facing option without changing native price,
                stock, or fulfillment records.
              </Drawer.Description>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
              <datalist id="catalog-reference-format">
                {formatReferences.map((reference: CatalogReferenceValue) => (
                  <option key={reference.id} value={reference.label} />
                ))}
              </datalist>
              <datalist id="catalog-reference-format-detail">
                {detailReferences.map((reference: CatalogReferenceValue) => (
                  <option key={reference.id} value={reference.label} />
                ))}
              </datalist>

              <AdminFormErrorSummary issues={issues} />
              {mutation.isError ? (
                <AdminRetryState
                  message={getAdminRequestErrorMessage(
                    mutation.error,
                    "The variant profile could not be saved. Your changes are still here."
                  )}
                  onRetry={handleSave}
                  retrying={mutation.isPending}
                  title="Save not confirmed"
                />
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <form.Field children={renderFormat} name="format" />
                <form.Field children={renderFormatDetail} name="formatDetail" />
              </div>
              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
                <Text weight="plus">Customer preview</Text>
                <Text className="mt-1" size="small">
                  {derivedLabel}
                </Text>
                <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                  {customerState.label}: {customerState.description}
                </Text>
              </div>
              <form.Field children={renderPreorder} name="preorderAllowed" />
              {!releaseIsFuture && values.preorderAllowed ? (
                <Text className="text-ui-fg-error" role="alert" size="small">
                  Set a future release date on the product before relying on
                  preorder messaging.
                </Text>
              ) : null}
              <form.Field children={renderBackorder} name="backorderAllowed" />
              {data?.allow_backorder ? (
                <Text className="text-ui-fg-subtle" size="small">
                  Native Medusa backorders are currently enabled for this
                  variant.
                </Text>
              ) : null}
              {values.backorderAllowed || values.preorderAllowed ? (
                <form.Field children={renderCustomerNote} name="customerNote" />
              ) : null}
              <form.Field children={renderImageUrl} name="imageUrl" />

              <details className="rounded-md border border-ui-border-base p-4">
                <summary className="cursor-pointer font-medium text-ui-fg-base focus-visible:rounded-sm focus-visible:shadow-borders-focus">
                  Advanced metadata
                </summary>
                <div className="mt-4">
                  <form.Field children={renderMetadata} name="metadata" />
                </div>
              </details>
            </Drawer.Body>
            <Drawer.Footer>
              <div className="mr-auto min-w-32">
                <AdminFormSaveState state={saveState} />
              </div>
              <Button
                disabled={mutation.isPending}
                onClick={requestClose}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={formState.isPristine || mutation.isPending}
                isLoading={mutation.isPending}
                onClick={handleSave}
                type="button"
              >
                Save catalog variant
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer>

        <ConfirmAction
          confirmLabel="Discard changes"
          description="Your unsaved format, availability, image, and advanced field changes will be lost. Native price and inventory records are not affected."
          onCancel={handleDiscardCancel}
          onConfirm={handleDiscardConfirm}
          open={discardOpen}
          title="Discard variant changes?"
          variant="danger"
        />
      </>
    )
  })

VariantCatalogProfileWidgetContent.displayName =
  "VariantCatalogProfileWidgetContent"

export const VariantCatalogProfileWidget =
  memo<VariantCatalogProfileWidgetProps>(({ data }) => (
    <AdminPermissionBoundary
      actions={catalogVariantProfileActions}
      surface="widget"
      workspace="Catalog variant profile"
    >
      <VariantCatalogProfileWidgetContent {...(data ? { data } : {})} />
    </AdminPermissionBoundary>
  ))

VariantCatalogProfileWidget.displayName = "VariantCatalogProfileWidget"
