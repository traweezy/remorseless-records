"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArchiveBox,
  GiftSolid,
  ShoppingBag,
  Sparkles,
  Trash,
} from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Skeleton,
  Text,
  Textarea,
} from "@medusajs/ui"
import {
  useBlocker,
  useNavigate,
} from "react-router-dom"

import { AdminFormField } from "../../components/admin-form-field"
import { AdminPageHeader, AdminSectionHeader } from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { ConfirmAction } from "../../components/confirm-action"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import {
  CatalogControlledInput,
  type CatalogControlledOption,
} from "./catalog-controlled-input"
import {
  CatalogCreationAvailability,
  resolveCatalogCreationAvailability,
} from "./catalog-creation-availability"
import { CatalogMerchandiseTemplates } from "./catalog-merchandise-templates"
import {
  applyCatalogCreationKind,
  buildCatalogProductCreateRequest,
  catalogCreationAvailabilityPolicies,
  catalogCreationDraftKey,
  catalogCreationFormSchema,
  catalogCreationKindDescriptions,
  catalogCreationKindLabels,
  catalogCreationKinds,
  catalogCreationReleaseDatePrecisions,
  createCatalogCreationDefaults,
  createCatalogCreationMerchandiseOfferings,
  parseCatalogCreationDraft,
  resolveCatalogCreationHandle,
  serializeCatalogCreationDraft,
  validateCatalogCreationStep,
  type CatalogCreationBundleComponent,
  type CatalogCreationFormValues,
  type CatalogCreationKind,
  type CatalogCreationMerchandiseTemplateId,
  type CatalogCreationOffering,
  type CatalogCreationReferenceChoice,
  type CatalogCreationReleaseDatePrecision,
} from "./catalog-product-create-form"
import {
  catalogCreationVocabularyQueryOptions,
  catalogProductChoicesQueryOptions,
  createCatalogProduct,
  decideCatalogProductCreationRetry,
  getCatalogProductCreationStatus,
  type CatalogCreationProductChoiceWithStock,
} from "./catalog-product-create-query"

const steps = ["Kind", "Basics", "Offerings", "Details", "Review"] as const
const primaryActionClassName =
  "hover:!bg-ui-button-inverted active:!bg-ui-button-inverted"

const kindIcons = {
  music_release: ArchiveBox,
  merch: ShoppingBag,
  fixed_bundle: GiftSolid,
  mystery_bundle: Sparkles,
} satisfies Record<CatalogCreationKind, typeof ArchiveBox>

const restoredDraft = (): {
  step: number
  values: CatalogCreationFormValues
} | null => {
  try {
    return parseCatalogCreationDraft(
      globalThis.localStorage?.getItem(catalogCreationDraftKey) ?? null,
    )
  } catch {
    return null
  }
}

const writeDraft = (values: CatalogCreationFormValues, step: number): void => {
  try {
    globalThis.localStorage?.setItem(
      catalogCreationDraftKey,
      serializeCatalogCreationDraft(values, step),
    )
  } catch {
    // The form remains usable when browser storage is blocked or full.
  }
}

const removeDraft = (): void => {
  try {
    globalThis.localStorage?.removeItem(catalogCreationDraftKey)
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

const readInputValue = (
  event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

type DataTarget = {
  checked?: boolean
  dataset?: Record<string, string | undefined>
  name?: string
  type?: string
  value?: string
}

const dataTarget = (event: { currentTarget: EventTarget }): DataTarget =>
  event.currentTarget as unknown as DataTarget

type BrowserEnvironment = {
  addEventListener?: (name: string, listener: (event: Event) => void) => void
  removeEventListener?: (name: string, listener: (event: Event) => void) => void
}

type ScrollTarget = {
  scrollIntoView: (options: {
    behavior: "auto" | "smooth"
    block: "start"
  }) => void
}

const offeringLabel = (kind: CatalogCreationKind): string => {
  if (kind === "merch") {
    return "Size and color combination"
  }
  if (kind === "fixed_bundle") {
    return "Bundle format"
  }
  if (kind === "mystery_bundle") {
    return "Mystery box option"
  }
  return "Release format"
}

const availabilityPolicyLabels = {
  backorder: "Accept backorders",
  inventory_only: "Stop at zero",
  preorder: "Accept preorders",
} as const

const availabilityPolicyHints = {
  backorder:
    "Native backorders keep ordering open after exact inventory reaches zero.",
  inventory_only: "Ordering stops when exact native inventory reaches zero.",
  preorder:
    "Preorders use the future release date and native backorders so zero-stock orders can be accepted.",
} as const

const stockLabel = (quantity: number | null, managed: boolean): string => {
  if (!managed || quantity === null) {
    return "Stock unavailable"
  }
  if (quantity === 0) {
    return "Sold out"
  }
  return `${quantity} in stock`
}

const selectedProduct = (
  choices: CatalogCreationProductChoiceWithStock[],
  productId: string,
): CatalogCreationProductChoiceWithStock | undefined =>
  choices.find((choice) => choice.id === productId)

const selectedVariant = (
  choices: CatalogCreationProductChoiceWithStock[],
  component: CatalogCreationBundleComponent,
) =>
  selectedProduct(choices, component.productId)?.variants.find(
    (variant) => variant.id === component.variantId,
  )

const CatalogCreationProgress = memo<{ current: number }>(({ current }) => (
  <ol aria-label="Product creation progress" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
    {steps.map((step, index) => (
      <li
        aria-current={current === index ? "step" : undefined}
        className={`rounded-md border px-3 py-2 ${
          current === index
            ? "border-ui-border-interactive bg-ui-bg-highlight text-ui-fg-base"
            : index < current
              ? "border-ui-border-base bg-ui-bg-subtle text-ui-fg-base"
              : "border-ui-border-base text-ui-fg-subtle"
        }`}
        key={step}
      >
        <Text size="xsmall" weight="plus">
          {index + 1}. {step}
        </Text>
      </li>
    ))}
  </ol>
))

CatalogCreationProgress.displayName = "CatalogCreationProgress"

const StepErrorSummary = memo<{ errors: string[] }>(({ errors }) =>
  errors.length ? (
    <div
      aria-live="polite"
      className="rounded-md border border-ui-border-error bg-ui-bg-error p-3"
      role="alert"
    >
      <Text className="text-ui-fg-error" size="small" weight="plus">
        Review this step
      </Text>
      <ul className="mt-1 list-disc pl-5 text-ui-fg-error">
        {Array.from(new Set(errors)).map((error) => (
          <li key={error}>
            <Text size="xsmall">{error}</Text>
          </li>
        ))}
      </ul>
    </div>
  ) : null,
)

StepErrorSummary.displayName = "StepErrorSummary"

const releaseDatePrecisionLabels: Record<
  CatalogCreationReleaseDatePrecision,
  string
> = {
  day: "Exact day",
  month: "Month only",
  unknown: "Not known",
  year: "Year only",
}

const releaseDateInputType = (
  precision: CatalogCreationReleaseDatePrecision,
): "date" | "month" | "number" => {
  if (precision === "day") {
    return "date"
  }
  if (precision === "month") {
    return "month"
  }
  return "number"
}

export const CatalogProductCreatePage = memo(() => {
  const initialDraft = useMemo(restoredDraft, [])
  const initialValues = useMemo(
    () => initialDraft?.values ?? createCatalogCreationDefaults(),
    [initialDraft],
  )
  const navigate = useNavigate()
  const [step, setStep] = useState(initialDraft?.step ?? 0)
  const [stepErrors, setStepErrors] = useState<string[]>([])
  const [clearOpen, setClearOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [allowNavigation, setAllowNavigation] = useState(false)
  const [draftPersistenceEnabled, setDraftPersistenceEnabled] = useState(
    Boolean(initialDraft),
  )
  const [resumed, setResumed] = useState(Boolean(initialDraft))
  const [submitted, setSubmitted] = useState(false)
  const pageStartRef = useRef<HTMLDivElement>(null)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const lastSubmittedValuesRef = useRef<string | null>(null)

  const choicesQuery = useQuery({
    ...catalogProductChoicesQueryOptions(),
    enabled: (initialDraft?.values.kind ?? "music_release") === "fixed_bundle",
  })
  const choicesData = choicesQuery.data
  const choicesFetching = choicesQuery.isFetching
  const choicesFetched = choicesQuery.isFetched
  const refetchChoices = choicesQuery.refetch
  const vocabularyQuery = useQuery(catalogCreationVocabularyQueryOptions())
  const vocabulary = vocabularyQuery.data
  const vocabularyLoading = vocabularyQuery.isPending
  const vocabularyUnavailable = vocabularyQuery.isError
  const refetchVocabulary = vocabularyQuery.refetch
  const creationMutation = useMutation({ mutationFn: createCatalogProduct })
  const retryStatusMutation = useMutation({
    mutationFn: getCatalogProductCreationStatus,
  })

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const serialized = JSON.stringify(value)
      if (
        lastSubmittedValuesRef.current &&
        lastSubmittedValuesRef.current !== serialized
      ) {
        idempotencyKeyRef.current = crypto.randomUUID()
      }
      lastSubmittedValuesRef.current = serialized
      const request = buildCatalogProductCreateRequest(
        value,
        idempotencyKeyRef.current,
        choicesData ?? [],
        vocabulary,
      )
      let result: Awaited<ReturnType<typeof createCatalogProduct>>
      try {
        result = await creationMutation.mutateAsync(request)
      } catch {
        // React Query owns the actionable error and retry state rendered below.
        return
      }
      removeDraft()
      setSubmitted(true)
      setAllowNavigation(true)
      navigate(`/products/${encodeURIComponent(result.productId)}`)
    },
    validators: { onChange: catalogCreationFormSchema },
  })
  const formState = useStore(form.store, (state) => ({
    canSubmit: state.canSubmit,
    isDirty: state.isDirty,
    isSubmitting: state.isSubmitting,
    values: state.values,
  }))
  const values = formState.values
  const creationIsError = creationMutation.isError
  const resetCreationMutation = creationMutation.reset
  const inspectRetryStatus = retryStatusMutation.mutateAsync
  const retryStatusIsPending = retryStatusMutation.isPending
  const resetRetryStatusMutation = retryStatusMutation.reset
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      formState.isDirty &&
      !allowNavigation &&
      currentLocation.pathname !== nextLocation.pathname,
  )
  const artistOptions = useMemo<CatalogControlledOption[]>(
    () =>
      (vocabulary?.artists ?? []).map((artist) => ({
        id: artist.id,
        label: artist.name,
      })),
    [vocabulary?.artists],
  )
  const referenceOptions = useMemo(() => {
    const byKind = (
      kind: CatalogCreationReferenceChoice["kind"],
    ): CatalogControlledOption[] =>
      (vocabulary?.references ?? [])
        .filter((reference) => reference.kind === kind && reference.isActive)
        .map((reference) => ({
          id: reference.id,
          label: reference.label,
        }))
    return {
      genre: byKind("genre"),
      label: byKind("label"),
      merchType: byKind("merch_type"),
      productType: byKind("product_type"),
    }
  }, [vocabulary?.references])
  const availabilityByOfferingId = useMemo(
    () =>
      new Map(
        values.offerings.map((offering) => [
          offering.id,
          resolveCatalogCreationAvailability({
            bundleComponents: values.bundleComponents,
            choices: choicesData ?? [],
            kind: values.kind,
            offering,
            releaseDate: values.releaseDate,
            releaseDatePrecision: values.releaseDatePrecision,
          }),
        ]),
      ),
    [choicesData, values],
  )

  useEffect(() => {
    if (!submitted && (draftPersistenceEnabled || formState.isDirty)) {
      const timeout = setTimeout(() => {
        writeDraft(values, step)
        if (!draftPersistenceEnabled) {
          setDraftPersistenceEnabled(true)
        }
      }, 250)
      return () => clearTimeout(timeout)
    }
    return undefined
  }, [draftPersistenceEnabled, formState.isDirty, step, submitted, values])

  useEffect(() => {
    const submittedValues = lastSubmittedValuesRef.current
    if (
      creationIsError &&
      submittedValues &&
      submittedValues !== JSON.stringify(values)
    ) {
      resetCreationMutation()
      resetRetryStatusMutation()
    }
  }, [
    creationIsError,
    resetCreationMutation,
    resetRetryStatusMutation,
    values,
  ])

  useEffect(() => {
    if (blocker.state === "blocked") {
      setLeaveOpen(true)
    }
  }, [blocker.state])

  useEffect(() => {
    const handleBeforeUnload = (event: Event) => {
      if (formState.isDirty && !allowNavigation) {
        writeDraft(values, step)
        event.preventDefault()
        ;(event as unknown as { returnValue: string }).returnValue = ""
      }
    }
    const browser = globalThis as BrowserEnvironment
    browser.addEventListener?.("beforeunload", handleBeforeUnload)
    return () => browser.removeEventListener?.("beforeunload", handleBeforeUnload)
  }, [allowNavigation, formState.isDirty, step, values])

  useEffect(() => {
    if (
      values.kind === "fixed_bundle" &&
      !choicesData &&
      !choicesFetching &&
      !choicesFetched
    ) {
      void refetchChoices()
    }
  }, [choicesData, choicesFetched, choicesFetching, refetchChoices, values.kind])

  const setField = useCallback(
    (field: keyof CatalogCreationFormValues, value: string) => {
      form.setFieldValue(field, value as never)
      setStepErrors([])
    },
    [form],
  )

  const setControlledField = useCallback(
    (
      field: keyof CatalogCreationFormValues,
      idField: keyof CatalogCreationFormValues,
      value: string,
      selectedId: string,
    ) => {
      form.setFieldValue(field, value as never)
      form.setFieldValue(idField, selectedId as never)
      setStepErrors([])
    },
    [form],
  )

  const handleArtistChange = useCallback(
    (value: string, selectedId: string) =>
      setControlledField("artistName", "artistId", value, selectedId),
    [setControlledField],
  )
  const handleLabelChange = useCallback(
    (value: string, selectedId: string) =>
      setControlledField("label", "labelId", value, selectedId),
    [setControlledField],
  )
  const handleGenreChange = useCallback(
    (value: string, selectedId: string) =>
      setControlledField("genre", "genreId", value, selectedId),
    [setControlledField],
  )
  const handleProductTypeChange = useCallback(
    (value: string, selectedId: string) =>
      setControlledField(
        "productType",
        "productTypeId",
        value,
        selectedId,
      ),
    [setControlledField],
  )
  const handleMerchandiseTypeChange = useCallback(
    (value: string, selectedId: string) =>
      setControlledField(
        "merchandiseType",
        "merchandiseTypeId",
        value,
        selectedId,
      ),
    [setControlledField],
  )
  const handleReleaseDatePrecisionChange = useCallback(
    (precision: string) => {
      if (
        !catalogCreationReleaseDatePrecisions.includes(
          precision as CatalogCreationReleaseDatePrecision,
        )
      ) {
        return
      }
      form.setFieldValue(
        "releaseDatePrecision",
        precision as CatalogCreationReleaseDatePrecision,
      )
      form.setFieldValue("releaseDate", "")
      setStepErrors([])
    },
    [form],
  )

  const handleTextChange = useCallback(
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      setField(
        dataTarget(event).name as keyof CatalogCreationFormValues,
        readInputValue(event),
      )
    },
    [setField],
  )

  const handleKindSelect = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const kind = dataTarget(event).dataset?.kind as
        | CatalogCreationKind
        | undefined
      if (!kind || kind === values.kind) {
        return
      }
      const nextValues = applyCatalogCreationKind(values, kind)
      // Replacing mount defaults here makes useForm restore the prior kind.
      form.reset(nextValues, { keepDefaultValues: true })
      form.setFieldValue("kind", kind)
      idempotencyKeyRef.current = crypto.randomUUID()
      lastSubmittedValuesRef.current = null
      setStepErrors([])
    },
    [form, values],
  )

  const updateOffering = useCallback(
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      const target = dataTarget(event)
      const offeringId = target.dataset?.offeringId
      const field = target.dataset?.offeringField as
        | keyof CatalogCreationOffering
        | undefined
      if (!offeringId || !field) {
        return
      }
      const value =
        target.type === "checkbox"
          ? (target.checked ?? false)
          : (target.value ?? "")
      form.setFieldValue(
        "offerings",
        values.offerings.map((offering) =>
          offering.id === offeringId
            ? { ...offering, [field]: value }
            : offering,
        ),
      )
      setStepErrors([])
    },
    [form, values.offerings],
  )

  const addOffering = useCallback(() => {
    const template = applyCatalogCreationKind(values, values.kind).offerings[0]!
    form.setFieldValue("offerings", [
      ...values.offerings,
      {
        ...template,
        id: crypto.randomUUID(),
        sku: "",
        title: `${offeringLabel(values.kind)} ${values.offerings.length + 1}`,
      },
    ])
  }, [form, values])

  const applyMerchandiseTemplate = useCallback(
    (templateId: CatalogCreationMerchandiseTemplateId) => {
      form.setFieldValue(
        "offerings",
        createCatalogCreationMerchandiseOfferings(
          templateId,
          values.offerings,
        ),
      )
      setStepErrors([])
    },
    [form, values.offerings],
  )

  const removeOffering = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const offeringId = dataTarget(event).dataset?.offeringId
      if (!offeringId || values.offerings.length <= 1) {
        return
      }
      form.setFieldValue(
        "offerings",
        values.offerings.filter((offering) => offering.id !== offeringId),
      )
      form.setFieldValue(
        "bundleComponents",
        values.bundleComponents.map((component) => ({
          ...component,
          offeringIds: component.offeringIds.filter(
            (id) => id !== offeringId,
          ),
        })),
      )
    },
    [form, values.bundleComponents, values.offerings],
  )

  const addBundleComponent = useCallback(() => {
    const product = choicesData?.[0]
    const variant = product?.variants[0]
    form.setFieldValue("bundleComponents", [
      ...values.bundleComponents,
      {
        id: crypto.randomUUID(),
        offeringIds: values.offerings.map((offering) => offering.id),
        productId: product?.id ?? "",
        quantity: "1",
        variantId: variant?.id ?? "",
      },
    ])
  }, [choicesData, form, values.bundleComponents, values.offerings])

  const updateBundleComponent = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = dataTarget(event)
      const componentId = target.dataset?.componentId
      const field = target.dataset?.componentField as
        | "productId"
        | "quantity"
        | "variantId"
        | undefined
      if (!componentId || !field) {
        return
      }
      const value = target.value ?? ""
      form.setFieldValue(
        "bundleComponents",
        values.bundleComponents.map((component) => {
          if (component.id !== componentId) {
            return component
          }
          if (field === "productId") {
            const product = selectedProduct(choicesData ?? [], value)
            return {
              ...component,
              productId: value,
              variantId: product?.variants[0]?.id ?? "",
            }
          }
          return { ...component, [field]: value }
        }),
      )
      setStepErrors([])
    },
    [choicesData, form, values.bundleComponents],
  )

  const updateBundleMapping = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const target = dataTarget(event)
      const componentId = target.dataset?.componentId
      const offeringId = target.dataset?.offeringId
      if (!componentId || !offeringId) {
        return
      }
      form.setFieldValue(
        "bundleComponents",
        values.bundleComponents.map((component) => {
          if (component.id !== componentId) {
            return component
          }
          return {
            ...component,
            offeringIds: target.checked
              ? Array.from(new Set([...component.offeringIds, offeringId]))
              : component.offeringIds.filter((id) => id !== offeringId),
          }
        }),
      )
      setStepErrors([])
    },
    [form, values.bundleComponents],
  )

  const removeBundleComponent = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const componentId = dataTarget(event).dataset?.componentId
      if (!componentId) {
        return
      }
      form.setFieldValue(
        "bundleComponents",
        values.bundleComponents.filter(
          (component) => component.id !== componentId,
        ),
      )
    },
    [form, values.bundleComponents],
  )

  const goToStep = useCallback((nextStep: number) => {
    setStep(nextStep)
    setStepErrors([])
    const target = pageStartRef.current as unknown as ScrollTarget | null
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const handleNext = useCallback(() => {
    const errors = validateCatalogCreationStep(values, step)
    if (errors.length) {
      setStepErrors(errors)
      return
    }
    goToStep(Math.min(steps.length - 1, step + 1))
  }, [goToStep, step, values])

  const handleBack = useCallback(() => {
    goToStep(Math.max(0, step - 1))
  }, [goToStep, step])

  const handleChangeStep = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const nextStep = Number(dataTarget(event).dataset?.step)
      if (Number.isInteger(nextStep)) {
        goToStep(nextStep)
      }
    },
    [goToStep],
  )

  const handleSave = useCallback(() => {
    const result = catalogCreationFormSchema.safeParse(values)
    if (!result.success) {
      setStepErrors(result.error.issues.map((issue) => issue.message))
      return
    }
    void form.handleSubmit()
  }, [form, values])

  const handleRetry = useCallback(() => {
    const validation = catalogCreationFormSchema.safeParse(values)
    if (!validation.success) {
      setStepErrors(validation.error.issues.map((issue) => issue.message))
      return
    }

    void (async () => {
      let state: Awaited<
        ReturnType<typeof getCatalogProductCreationStatus>
      >["state"]
      try {
        const status = await inspectRetryStatus(
          idempotencyKeyRef.current,
        )
        state = status.state
      } catch (error) {
        setStepErrors([
          getAdminRequestErrorMessage(
            error,
            "The previous attempt could not be checked. Try again.",
          ),
        ])
        return
      }
      const decision = decideCatalogProductCreationRetry(state)
      if (decision === "wait") {
        setStepErrors([
          "The previous creation attempt is still running. Wait a moment, then try again.",
        ])
        return
      }
      if (decision === "blocked") {
        setStepErrors([
          "This attempt needs an operator to reconcile it before the product can be retried safely.",
        ])
        return
      }
      if (decision === "new-key") {
        idempotencyKeyRef.current = crypto.randomUUID()
        lastSubmittedValuesRef.current = null
      }
      setStepErrors([])
      void form.handleSubmit()
    })()
  }, [form, inspectRetryStatus, values])

  const handleCancel = useCallback(() => {
    if (formState.isDirty) {
      setLeaveOpen(true)
      return
    }
    setAllowNavigation(true)
    navigate("/catalog-authoring")
  }, [formState.isDirty, navigate])

  const handleLeaveCancel = useCallback(() => {
    setLeaveOpen(false)
    if (blocker.state === "blocked") {
      blocker.reset()
    }
  }, [blocker])

  const handleLeaveConfirm = useCallback(() => {
    if (formState.isDirty) {
      writeDraft(values, step)
    }
    setLeaveOpen(false)
    setAllowNavigation(true)
    if (blocker.state === "blocked") {
      blocker.proceed()
      return
    }
    navigate("/catalog-authoring")
  }, [blocker, formState.isDirty, navigate, step, values])

  const handleClearDraftRequest = useCallback(() => setClearOpen(true), [])
  const handleClearDraftCancel = useCallback(() => setClearOpen(false), [])

  const handleClearDraftConfirm = useCallback(() => {
    removeDraft()
    const defaults = createCatalogCreationDefaults()
    form.reset(defaults, { keepDefaultValues: true })
    idempotencyKeyRef.current = crypto.randomUUID()
    lastSubmittedValuesRef.current = null
    resetCreationMutation()
    resetRetryStatusMutation()
    setClearOpen(false)
    setDraftPersistenceEnabled(false)
    setResumed(false)
    setStep(0)
    setStepErrors([])
  }, [form, resetCreationMutation, resetRetryStatusMutation])

  const handleChoicesRetry = useCallback(() => {
    void refetchChoices()
  }, [refetchChoices])

  const handleVocabularyRetry = useCallback(() => {
    void refetchVocabulary()
  }, [refetchVocabulary])

  const busy =
    creationMutation.isPending ||
    formState.isSubmitting ||
    retryStatusIsPending
  const previewRoute =
    values.kind === "music_release"
      ? "music-release"
      : values.kind === "merch"
        ? "merch"
        : "bundle"
  const previewUrl = `/${previewRoute}/${resolveCatalogCreationHandle(values.handle, values.title)}`

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" ref={pageStartRef}>
      <AdminPageHeader
        actions={
          <Button onClick={handleClearDraftRequest} size="small" type="button" variant="secondary">
            Clear draft
          </Button>
        }
        description="Build a draft through one validated workflow. Nothing is written until the final review."
        status={<Badge color="grey">Draft</Badge>}
        title="Create catalog product"
      />

      {resumed ? (
        <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
          <Text size="small">Your saved browser draft has been restored.</Text>
        </div>
      ) : null}

      <CatalogCreationProgress current={step} />
      <StepErrorSummary errors={stepErrors} />
      {creationMutation.isError ? (
        <AdminRetryState
          message={getAdminRequestErrorMessage(
            creationMutation.error,
            "The product could not be created. Your form values are still here.",
          )}
          onRetry={handleRetry}
          retrying={busy}
          title="Draft creation failed"
        />
      ) : null}

      {step === 0 ? (
        <Container className="p-6">
          <AdminSectionHeader
            description="Choose the closest match. This controls the questions, inventory behavior, and bundle rules that follow."
            title="What are you selling?"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {catalogCreationKinds.map((kind) => {
              const Icon = kindIcons[kind]
              const selected = values.kind === kind
              return (
                <button
                  aria-pressed={selected}
                  className={`min-h-32 cursor-pointer rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-border-interactive ${
                    selected
                      ? "border-ui-border-interactive bg-ui-bg-highlight"
                      : "border-ui-border-base bg-ui-bg-base hover:bg-ui-bg-subtle"
                  }`}
                  data-kind={kind}
                  key={kind}
                  onClick={handleKindSelect}
                  type="button"
                >
                  <Icon className="h-5 w-5 text-ui-fg-interactive" />
                  <Text className="mt-3" weight="plus">
                    {catalogCreationKindLabels[kind]}
                  </Text>
                  <Text className="mt-1 text-ui-fg-subtle" size="small">
                    {catalogCreationKindDescriptions[kind]}
                  </Text>
                </button>
              )
            })}
          </div>
        </Container>
      ) : null}

      {step === 1 ? (
        <Container className="p-6">
          <AdminSectionHeader
            description={`Customer-facing basics for this ${catalogCreationKindLabels[values.kind].toLowerCase()}.`}
            title="Product basics"
          />
          {vocabularyUnavailable ? (
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ui-border-error bg-ui-bg-error p-3"
              role="alert"
            >
              <Text className="text-ui-fg-error" size="small">
                Existing catalog choices could not be loaded. Typed names are
                still deduplicated safely when the draft is created.
              </Text>
              <Button
                onClick={handleVocabularyRetry}
                size="small"
                type="button"
                variant="secondary"
              >
                Retry choices
              </Button>
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <AdminFormField
              id="catalog-create-title"
              label={values.kind === "music_release" ? "Release title" : "Product name"}
            >
              {(control) => (
                <Input {...control} name="title" onChange={handleTextChange} value={values.title} />
              )}
            </AdminFormField>
            <AdminFormField
              hint="Preselected from the product kind; change it only when a more specific customer-facing type is useful."
              id="catalog-create-product-type"
              label="Product type"
            >
              {(control) => (
                <CatalogControlledInput
                  control={control}
                  entityLabel="product type"
                  loading={vocabularyLoading}
                  name="productType"
                  onChange={handleProductTypeChange}
                  options={referenceOptions.productType}
                  unavailable={vocabularyUnavailable}
                  value={values.productType}
                />
              )}
            </AdminFormField>
            {values.kind === "music_release" ? (
              <>
                <AdminFormField id="catalog-create-artist" label="Primary artist">
                  {(control) => (
                    <CatalogControlledInput
                      control={control}
                      entityLabel="artist"
                      loading={vocabularyLoading}
                      name="artistName"
                      onChange={handleArtistChange}
                      options={artistOptions}
                      unavailable={vocabularyUnavailable}
                      value={values.artistName}
                    />
                  )}
                </AdminFormField>
                <AdminFormField id="catalog-create-label" label="Label or source" optional>
                  {(control) => (
                    <CatalogControlledInput
                      control={control}
                      entityLabel="label"
                      loading={vocabularyLoading}
                      name="label"
                      onChange={handleLabelChange}
                      options={referenceOptions.label}
                      unavailable={vocabularyUnavailable}
                      value={values.label}
                    />
                  )}
                </AdminFormField>
                <AdminFormField id="catalog-create-genre" label="Genre" optional>
                  {(control) => (
                    <CatalogControlledInput
                      control={control}
                      entityLabel="genre"
                      loading={vocabularyLoading}
                      name="genre"
                      onChange={handleGenreChange}
                      options={referenceOptions.genre}
                      unavailable={vocabularyUnavailable}
                      value={values.genre}
                    />
                  )}
                </AdminFormField>
                <AdminFormField id="catalog-create-date-precision" label="Release date detail">
                  {(control) => (
                    <Select
                      onValueChange={handleReleaseDatePrecisionChange}
                      value={values.releaseDatePrecision}
                    >
                      <Select.Trigger {...control}>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        {catalogCreationReleaseDatePrecisions.map((precision) => (
                          <Select.Item key={precision} value={precision}>
                            {releaseDatePrecisionLabels[precision]}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  )}
                </AdminFormField>
                {values.releaseDatePrecision !== "unknown" ? (
                  <AdminFormField
                    id="catalog-create-date"
                    label={`Release ${values.releaseDatePrecision}`}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        inputMode={values.releaseDatePrecision === "year" ? "numeric" : undefined}
                        max={values.releaseDatePrecision === "year" ? 2200 : undefined}
                        min={values.releaseDatePrecision === "year" ? 1900 : undefined}
                        name="releaseDate"
                        onChange={handleTextChange}
                        type={releaseDateInputType(values.releaseDatePrecision)}
                        value={values.releaseDate}
                      />
                    )}
                  </AdminFormField>
                ) : null}
                <AdminFormField id="catalog-create-number" label="Catalog number" optional>
                  {(control) => (
                    <Input {...control} name="catalogNumber" onChange={handleTextChange} value={values.catalogNumber} />
                  )}
                </AdminFormField>
              </>
            ) : null}
            {values.kind === "merch" ? (
              <AdminFormField
                hint="Examples include shirt, hoodie, patch, pin, and poster."
                id="catalog-create-merch-type"
                label="Merchandise type"
              >
                {(control) => (
                  <CatalogControlledInput
                    control={control}
                    entityLabel="merchandise type"
                    loading={vocabularyLoading}
                    name="merchandiseType"
                    onChange={handleMerchandiseTypeChange}
                    options={referenceOptions.merchType}
                    unavailable={vocabularyUnavailable}
                    value={values.merchandiseType}
                  />
                )}
              </AdminFormField>
            ) : null}
            <AdminFormField className="md:col-span-2" id="catalog-create-description" label="Store description" optional>
              {(control) => (
                <Textarea {...control} name="description" onChange={handleTextChange} rows={5} value={values.description} />
              )}
            </AdminFormField>
            <details className="md:col-span-2 rounded-md border border-ui-border-base p-4">
              <summary className="flex min-h-6 cursor-pointer items-center text-sm font-medium">Advanced URL</summary>
              <div className="mt-4">
                <AdminFormField
                  hint="Leave blank to generate it from the product name."
                  id="catalog-create-handle"
                  label="URL handle"
                  optional
                >
                  {(control) => (
                    <Input {...control} name="handle" onChange={handleTextChange} value={values.handle} />
                  )}
                </AdminFormField>
              </div>
            </details>
          </div>
        </Container>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <Container className="p-6">
            <AdminSectionHeader
              actions={<Button onClick={addOffering} size="small" type="button" variant="secondary">Add offering</Button>}
              description="Each row becomes a native Medusa variant with its own price and exact inventory."
              title="Offerings"
            />
            {values.kind === "merch" ? (
              <div className="mt-5">
                <CatalogMerchandiseTemplates
                  currentCount={values.offerings.length}
                  onApply={applyMerchandiseTemplate}
                />
              </div>
            ) : null}
            <div className="mt-5 flex flex-col gap-4">
              {values.offerings.map((offering, index) => {
                const availability = availabilityByOfferingId.get(offering.id)!
                return (
                  <section className="rounded-lg border border-ui-border-base p-4" key={offering.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Heading level="h3">{offeringLabel(values.kind)} {index + 1}</Heading>
                      <Text className="mt-1 text-ui-fg-subtle" size="xsmall">Shown to customers as {offering.title || "Untitled"}.</Text>
                    </div>
                    <Button
                      aria-label={`Remove offering ${index + 1}`}
                      data-offering-id={offering.id}
                      disabled={values.offerings.length === 1}
                      onClick={removeOffering}
                      size="small"
                      type="button"
                      variant="secondary"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {values.kind === "merch" ? (
                      <>
                        <AdminFormField id={`offering-${offering.id}-size`} label="Size or style">
                          {(control) => (
                            <Input {...control} data-offering-field="size" data-offering-id={offering.id} onChange={updateOffering} value={offering.size} />
                          )}
                        </AdminFormField>
                        <AdminFormField id={`offering-${offering.id}-color`} label="Color" optional>
                          {(control) => (
                            <Input {...control} data-offering-field="color" data-offering-id={offering.id} onChange={updateOffering} value={offering.color} />
                          )}
                        </AdminFormField>
                      </>
                    ) : (
                      <>
                        <AdminFormField id={`offering-${offering.id}-format`} label="Format">
                          {(control) => (
                            <Input {...control} data-offering-field="format" data-offering-id={offering.id} onChange={updateOffering} value={offering.format} />
                          )}
                        </AdminFormField>
                        <AdminFormField id={`offering-${offering.id}-detail`} label="Format detail" optional>
                          {(control) => (
                            <Input {...control} data-offering-field="formatDetail" data-offering-id={offering.id} onChange={updateOffering} value={offering.formatDetail} />
                          )}
                        </AdminFormField>
                      </>
                    )}
                    <AdminFormField id={`offering-${offering.id}-title`} label="Customer label">
                      {(control) => (
                        <Input {...control} data-offering-field="title" data-offering-id={offering.id} onChange={updateOffering} value={offering.title} />
                      )}
                    </AdminFormField>
                    <AdminFormField id={`offering-${offering.id}-sku`} label="SKU" optional>
                      {(control) => (
                        <Input {...control} data-offering-field="sku" data-offering-id={offering.id} onChange={updateOffering} value={offering.sku} />
                      )}
                    </AdminFormField>
                    <AdminFormField id={`offering-${offering.id}-price`} label="USD price">
                      {(control) => (
                        <Input {...control} data-offering-field="priceUsd" data-offering-id={offering.id} inputMode="decimal" min="0" onChange={updateOffering} step="0.01" type="number" value={offering.priceUsd} />
                      )}
                    </AdminFormField>
                    {values.kind === "fixed_bundle" ? (
                      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                        <Text size="small" weight="plus">Component-derived stock</Text>
                        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">Availability follows the products mapped below.</Text>
                      </div>
                    ) : (
                      <AdminFormField id={`offering-${offering.id}-stock`} label="Initial stock">
                        {(control) => (
                          <Input {...control} data-offering-field="stockQuantity" data-offering-id={offering.id} inputMode="numeric" min="0" onChange={updateOffering} step="1" type="number" value={offering.stockQuantity} />
                        )}
                      </AdminFormField>
                    )}
                    {values.kind !== "fixed_bundle" ? (
                      <AdminFormField
                        hint={
                          availabilityPolicyHints[offering.availabilityPolicy]
                        }
                        id={`offering-${offering.id}-availability-policy`}
                        label="Selling policy"
                      >
                        {(control) => (
                          <select
                            {...control}
                            className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2"
                            data-offering-field="availabilityPolicy"
                            data-offering-id={offering.id}
                            onChange={updateOffering}
                            value={offering.availabilityPolicy}
                          >
                            {catalogCreationAvailabilityPolicies
                              .filter((policy) => policy !== "preorder" || values.kind === "music_release")
                              .map((policy) => (
                                <option key={policy} value={policy}>
                                  {availabilityPolicyLabels[policy]}
                                </option>
                              ))}
                          </select>
                        )}
                      </AdminFormField>
                    ) : null}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <CatalogCreationAvailability preview={availability} />
                    </div>
                  </div>
                  </section>
                )
              })}
            </div>
          </Container>

          {values.kind === "fixed_bundle" ? (
            <Container className="p-6">
              <AdminSectionHeader
                actions={<Button disabled={!choicesData?.length} onClick={addBundleComponent} size="small" type="button" variant="secondary">Add included product</Button>}
                description="Map each included product format to the bundle formats that consume it. Sold-out items are allowed and will make the affected bundle unavailable."
                title="Included products"
              />
              {choicesQuery.isPending ? (
                <div aria-label="Loading product choices" className="mt-5 grid gap-3" role="status">
                  <Skeleton className="h-32" />
                  <Skeleton className="h-32" />
                </div>
              ) : choicesQuery.isError ? (
                <div className="mt-5">
                  <AdminRetryState
                    message={getAdminRequestErrorMessage(choicesQuery.error, "Product choices could not be loaded.")}
                    onRetry={handleChoicesRetry}
                    retrying={choicesQuery.isFetching}
                    title="Included products unavailable"
                  />
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  {values.bundleComponents.length ? values.bundleComponents.map((component, index) => {
                    const product = selectedProduct(choicesData ?? [], component.productId)
                    const variant = selectedVariant(choicesData ?? [], component)
                    return (
                      <section className="rounded-lg border border-ui-border-base p-4" key={component.id}>
                        <div className="flex items-start justify-between gap-3">
                          <Heading level="h3">Included product {index + 1}</Heading>
                          <Button aria-label={`Remove included product ${index + 1}`} data-component-id={component.id} onClick={removeBundleComponent} size="small" type="button" variant="secondary"><Trash className="h-4 w-4" /></Button>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <AdminFormField id={`component-${component.id}-product`} label="Product">
                            {(control) => (
                              <select {...control} className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2" data-component-field="productId" data-component-id={component.id} onChange={updateBundleComponent} value={component.productId}>
                                {(choicesData ?? []).map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
                              </select>
                            )}
                          </AdminFormField>
                          <AdminFormField hint={variant ? stockLabel(variant.inventoryQuantity, variant.managesInventory) : undefined} id={`component-${component.id}-variant`} label="Included format">
                            {(control) => (
                              <select {...control} className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2" data-component-field="variantId" data-component-id={component.id} onChange={updateBundleComponent} value={component.variantId}>
                                {(product?.variants ?? []).map((choice) => <option key={choice.id} value={choice.id}>{choice.title}{choice.sku ? ` · ${choice.sku}` : ""}</option>)}
                              </select>
                            )}
                          </AdminFormField>
                          <AdminFormField id={`component-${component.id}-quantity`} label="Quantity in bundle">
                            {(control) => (
                              <Input {...control} data-component-field="quantity" data-component-id={component.id} inputMode="numeric" min="1" onChange={updateBundleComponent} step="1" type="number" value={component.quantity} />
                            )}
                          </AdminFormField>
                          <fieldset className="rounded-md border border-ui-border-base p-3">
                            <legend className="px-1 text-sm font-medium">Used by bundle formats</legend>
                            <div className="mt-2 flex flex-wrap gap-3">
                              {values.offerings.map((offering) => (
                                <label className="flex min-h-8 cursor-pointer items-center gap-2" key={offering.id}>
                                  <input checked={component.offeringIds.includes(offering.id)} className="h-4 w-4" data-component-id={component.id} data-offering-id={offering.id} onChange={updateBundleMapping} type="checkbox" />
                                  <span className="text-sm">{offering.title}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      </section>
                    )
                  }) : (
                    <div className="rounded-md border border-dashed border-ui-border-base p-6 text-center">
                      <Text weight="plus">No included products yet</Text>
                      <Text className="mt-1 text-ui-fg-subtle" size="small">Add at least one product and map it to every bundle format.</Text>
                    </div>
                  )}
                </div>
              )}
            </Container>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <Container className="p-6">
          <AdminSectionHeader
            description="Only fields relevant to this product kind are shown. Media can be added from the product detail after the draft exists."
            title="Storefront details"
          />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {values.kind === "music_release" ? (
              <>
                <AdminFormField id="catalog-create-tracklist" label="Tracklist" hint="One track per line." optional>
                  {(control) => <Textarea {...control} name="tracklist" onChange={handleTextChange} rows={8} value={values.tracklist} />}
                </AdminFormField>
                <AdminFormField id="catalog-create-credits" label="Credits" hint="Plain-language performer, recording, and production credits." optional>
                  {(control) => <Textarea {...control} name="credits" onChange={handleTextChange} rows={8} value={values.credits} />}
                </AdminFormField>
              </>
            ) : null}
            {values.kind === "merch" ? (
              <>
                <AdminFormField id="catalog-create-material" label="Material" optional>
                  {(control) => <Textarea {...control} name="material" onChange={handleTextChange} rows={4} value={values.material} />}
                </AdminFormField>
                <AdminFormField id="catalog-create-fit" label="Fit and measurements" optional>
                  {(control) => <Textarea {...control} name="merchandiseFit" onChange={handleTextChange} rows={4} value={values.merchandiseFit} />}
                </AdminFormField>
                <AdminFormField
                  hint="List customer-facing measurements by size, one size per line."
                  id="catalog-create-size-guide"
                  label="Size guide"
                  optional
                >
                  {(control) => <Textarea {...control} name="sizeGuide" onChange={handleTextChange} rows={4} value={values.sizeGuide} />}
                </AdminFormField>
                <AdminFormField className="md:col-span-2" id="catalog-create-care" label="Care instructions" optional>
                  {(control) => <Textarea {...control} name="merchandiseCare" onChange={handleTextChange} rows={4} value={values.merchandiseCare} />}
                </AdminFormField>
              </>
            ) : null}
            {values.kind === "fixed_bundle" ? (
              <div className="md:col-span-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                <Text weight="plus">Included-content presentation</Text>
                <Text className="mt-1 text-ui-fg-subtle" size="small">The customer-facing bundle content is generated from the product and format mappings reviewed in the previous step.</Text>
              </div>
            ) : null}
            {values.kind === "mystery_bundle" ? (
              <>
                <AdminFormField id="catalog-create-promise" label="Customer promise" hint="Explain the type or minimum value of contents without revealing exact items.">
                  {(control) => <Textarea {...control} name="mysteryPromise" onChange={handleTextChange} rows={5} value={values.mysteryPromise} />}
                </AdminFormField>
                <AdminFormField id="catalog-create-disclaimer" label="Mystery box disclaimer" hint="Clarify substitutions, duplicates, and other expectations." optional>
                  {(control) => <Textarea {...control} name="mysteryDisclaimer" onChange={handleTextChange} rows={5} value={values.mysteryDisclaimer} />}
                </AdminFormField>
              </>
            ) : null}
          </div>
        </Container>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Container className="p-6">
            <AdminSectionHeader
              description="Nothing has been written yet. Review the customer-facing result before creating the draft."
              title="Review draft"
            />
            <div className="mt-5 divide-y rounded-lg border border-ui-border-base">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div><Text size="xsmall" className="text-ui-fg-subtle">Product</Text><Text weight="plus">{values.title || "Untitled"}</Text><Text size="small" className="text-ui-fg-subtle">{catalogCreationKindLabels[values.kind]} · {values.productType}</Text></div>
                <Button data-step="1" onClick={handleChangeStep} size="small" type="button" variant="secondary">Change basics</Button>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1"><Text size="xsmall" className="text-ui-fg-subtle">Offerings</Text><Text weight="plus">{values.offerings.length} {values.offerings.length === 1 ? "variant" : "variants"}</Text><Text size="small" className="break-words text-ui-fg-subtle">{values.offerings.map((offering) => `${offering.title} · $${offering.priceUsd}${values.kind === "fixed_bundle" ? " · component stock" : ` · ${offering.stockQuantity} stock`}`).join("; ")}</Text><div className="mt-3 grid gap-2">{values.offerings.map((offering) => <CatalogCreationAvailability key={offering.id} preview={availabilityByOfferingId.get(offering.id)!} />)}</div></div>
                <Button data-step="2" onClick={handleChangeStep} size="small" type="button" variant="secondary">Change offerings</Button>
              </div>
              {values.kind === "fixed_bundle" ? (
                <div className="p-4"><Text size="xsmall" className="text-ui-fg-subtle">Bundle mapping</Text><Text weight="plus">{values.bundleComponents.length} included {values.bundleComponents.length === 1 ? "product" : "products"}</Text><Text size="small" className="text-ui-fg-subtle">Every offering must have a required component before this draft can be created.</Text></div>
              ) : null}
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div><Text size="xsmall" className="text-ui-fg-subtle">Storefront details</Text><Text size="small">{values.description || "No short description yet."}</Text></div>
                <Button data-step="3" onClick={handleChangeStep} size="small" type="button" variant="secondary">Change details</Button>
              </div>
            </div>
          </Container>
          <Container className="h-fit p-5 lg:sticky lg:top-4">
            <Text size="xsmall" className="text-ui-fg-subtle">Customer preview</Text>
            <Heading className="mt-2 break-words" level="h2">{values.title || "Untitled product"}</Heading>
            {values.kind === "music_release" && values.artistName ? <Text className="mt-1 text-ui-fg-subtle">{values.artistName}</Text> : null}
            <Text className="mt-4 line-clamp-4" size="small">{values.description || "Add a short description so customers know what they are buying."}</Text>
            <div className="mt-4 flex flex-wrap gap-2">{values.offerings.map((offering) => <Badge color="grey" key={offering.id}>{offering.title} · ${offering.priceUsd}</Badge>)}</div>
            <Text className="mt-5 break-all text-ui-fg-subtle" size="xsmall">{previewUrl}</Text>
          </Container>
        </div>
      ) : null}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-ui-border-base bg-ui-bg-base/95 px-1 py-4 backdrop-blur">
        <Button disabled={busy} onClick={handleCancel} type="button" variant="secondary">Cancel</Button>
        <div className="flex flex-wrap gap-2">
          {step > 0 ? <Button disabled={busy} onClick={handleBack} type="button" variant="secondary">Back</Button> : null}
          {step < steps.length - 1 ? (
            <Button
              className={primaryActionClassName}
              disabled={busy}
              onClick={handleNext}
              type="button"
            >
              Continue
            </Button>
          ) : (
            <Button
              className={primaryActionClassName}
              disabled={busy || !formState.canSubmit}
              isLoading={busy}
              onClick={handleSave}
              type="button"
            >
              Create draft
            </Button>
          )}
        </div>
        <div aria-live="polite" className="sr-only">{busy ? "Creating draft product" : ""}</div>
      </div>

      <ConfirmAction
        confirmLabel="Clear draft"
        description="This removes the saved browser draft and resets every field. No Medusa product has been created."
        onCancel={handleClearDraftCancel}
        onConfirm={handleClearDraftConfirm}
        open={clearOpen}
        title="Clear this draft?"
        variant="danger"
      />

      <ConfirmAction
        confirmLabel="Leave creation"
        description="Your browser draft is saved for seven days, but the product has not been created in Medusa."
        onCancel={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        open={leaveOpen}
        title="Leave this draft?"
        variant="danger"
      />
    </div>
  )
})

CatalogProductCreatePage.displayName = "CatalogProductCreatePage"
