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
import { Badge, Button, Text } from "@medusajs/ui"
import {
  useBlocker,
  useNavigate,
} from "react-router-dom"

import { AdminPageHeader } from "../../components/admin-page"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { AdminRetryState } from "../../components/admin-retry-state"
import { ConfirmAction } from "../../components/confirm-action"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import { catalogProductCreateActions } from "../catalog-permissions"
import type { CatalogControlledOption } from "./catalog-controlled-input"
import {
  resolveCatalogCreationAvailability,
} from "./catalog-creation-availability"
import {
  CatalogCreationBasicsStep,
  type CatalogCreationReferenceOptions,
} from "./catalog-creation-basics-step"
import { CatalogCreationDetailsStep } from "./catalog-creation-details-step"
import { CatalogCreationKindStep } from "./catalog-creation-kind-step"
import { CatalogCreationOfferingsStep } from "./catalog-creation-offerings-step"
import { CatalogCreationReviewStep } from "./catalog-creation-review-step"
import {
  CatalogCreationValidationSummary,
} from "./catalog-creation-validation-summary"
import {
  createCatalogCreationGeneralIssue,
  resolveCatalogCreationValidationIssues,
  type CatalogCreationValidationIssue,
} from "./catalog-creation-validation"
import {
  CatalogCreationActions,
  CatalogCreationProgress,
  catalogCreationSteps,
} from "./catalog-creation-wizard-shell"
import {
  applyCatalogCreationKind,
  buildCatalogProductCreateRequest,
  catalogCreationDraftKey,
  catalogCreationFormSchema,
  catalogCreationReleaseDatePrecisions,
  createCatalogCreationDefaults,
  createCatalogCreationMerchandiseOfferings,
  parseCatalogCreationDraft,
  serializeCatalogCreationDraft,
  type CatalogCreationFormValues,
  type CatalogCreationKind,
  type CatalogCreationMerchandiseTemplateId,
  type CatalogCreationMedia,
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
  cancelAnimationFrame?: (frame: number) => void
  document?: {
    getElementById: (id: string) => FocusTarget | null
  }
  removeEventListener?: (name: string, listener: (event: Event) => void) => void
  requestAnimationFrame?: (callback: () => void) => number
}

type FocusTarget = {
  closest: (selector: string) => { open: boolean } | null
  focus: (options: { preventScroll: boolean }) => void
  scrollIntoView: (options: {
    behavior: "smooth"
    block: "center"
  }) => void
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

const selectedProduct = (
  choices: CatalogCreationProductChoiceWithStock[],
  productId: string,
): CatalogCreationProductChoiceWithStock | undefined =>
  choices.find((choice) => choice.id === productId)

const CatalogProductCreatePageContent = memo(() => {
  const initialDraft = useMemo(restoredDraft, [])
  const initialValues = useMemo(
    () => initialDraft?.values ?? createCatalogCreationDefaults(),
    [initialDraft],
  )
  const navigate = useNavigate()
  const [step, setStep] = useState(initialDraft?.step ?? 0)
  const [stepErrors, setStepErrors] = useState<
    CatalogCreationValidationIssue[]
  >([])
  const [clearOpen, setClearOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [allowNavigation, setAllowNavigation] = useState(false)
  const [draftPersistenceEnabled, setDraftPersistenceEnabled] = useState(
    Boolean(initialDraft),
  )
  const [resumed, setResumed] = useState(Boolean(initialDraft))
  const [submitted, setSubmitted] = useState(false)
  const [mediaUploading, setMediaUploading] = useState(false)
  const pageStartRef = useRef<HTMLDivElement>(null)
  const pendingFocusTargetRef = useRef<string | null>(null)
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
  const referenceOptions = useMemo<CatalogCreationReferenceOptions>(() => {
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

  const focusValidationTarget = useCallback((targetId: string) => {
    const browser = globalThis as BrowserEnvironment
    const target = browser.document?.getElementById(targetId)
    if (!target) {
      return
    }
    const disclosure = target.closest("details")
    if (disclosure) {
      disclosure.open = true
    }
    target.focus({ preventScroll: true })
    target.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  useEffect(() => {
    const targetId = pendingFocusTargetRef.current
    if (!targetId) {
      return undefined
    }
    pendingFocusTargetRef.current = null
    const browser = globalThis as BrowserEnvironment
    if (!browser.requestAnimationFrame || !browser.cancelAnimationFrame) {
      focusValidationTarget(targetId)
      return undefined
    }
    const frame = browser.requestAnimationFrame(() => {
      focusValidationTarget(targetId)
    })
    return () => browser.cancelAnimationFrame?.(frame)
  }, [focusValidationTarget, step])

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

  const handleMediaChange = useCallback(
    (media: CatalogCreationMedia[]) => {
      form.setFieldValue("media", media)
      setStepErrors([])
    },
    [form],
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
    pendingFocusTargetRef.current = null
    setStep(nextStep)
    setStepErrors([])
    const target = pageStartRef.current as unknown as ScrollTarget | null
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const handleNext = useCallback(() => {
    const issues = resolveCatalogCreationValidationIssues(values, step)
    if (issues.length) {
      setStepErrors(issues)
      return
    }
    goToStep(Math.min(catalogCreationSteps.length - 1, step + 1))
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

  const handleValidationNavigate = useCallback(
    (issue: CatalogCreationValidationIssue) => {
      if (!issue.targetId) {
        return
      }
      if (issue.step === step) {
        focusValidationTarget(issue.targetId)
        return
      }
      pendingFocusTargetRef.current = issue.targetId
      setStep(issue.step)
    },
    [focusValidationTarget, step],
  )

  const handleSave = useCallback(() => {
    const issues = resolveCatalogCreationValidationIssues(values)
    if (issues.length) {
      setStepErrors(issues)
      return
    }
    void form.handleSubmit()
  }, [form, values])

  const handleRetry = useCallback(() => {
    const issues = resolveCatalogCreationValidationIssues(values)
    if (issues.length) {
      setStepErrors(issues)
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
          createCatalogCreationGeneralIssue(
            getAdminRequestErrorMessage(
              error,
              "The previous attempt could not be checked. Try again.",
            ),
            step,
          ),
        ])
        return
      }
      const decision = decideCatalogProductCreationRetry(state)
      if (decision === "wait") {
        setStepErrors([
          createCatalogCreationGeneralIssue(
            "The previous creation attempt is still running. Wait a moment, then try again.",
            step,
          ),
        ])
        return
      }
      if (decision === "blocked") {
        setStepErrors([
          createCatalogCreationGeneralIssue(
            "This attempt needs an operator to reconcile it before the product can be retried safely.",
            step,
          ),
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
  }, [form, inspectRetryStatus, step, values])

  const handleCancel = useCallback(() => {
    if (formState.isDirty) {
      setLeaveOpen(true)
      return
    }
    setAllowNavigation(true)
    navigate("/products")
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
    navigate("/products")
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
    mediaUploading ||
    retryStatusIsPending
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" ref={pageStartRef}>
      <AdminPageHeader
        actions={
          <Button disabled={busy} onClick={handleClearDraftRequest} size="small" type="button" variant="secondary">
            Clear draft
          </Button>
        }
        description="Build a draft through one validated workflow. Product records are written only after final review; image uploads are stored when selected."
        status={<Badge color="grey">Draft</Badge>}
        title="Create catalog product"
      />

      {resumed ? (
        <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
          <Text size="small">Your saved browser draft has been restored.</Text>
        </div>
      ) : null}

      <CatalogCreationProgress current={step} />
      <CatalogCreationValidationSummary
        issues={stepErrors}
        onNavigate={handleValidationNavigate}
      />
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
        <CatalogCreationKindStep
          kind={values.kind}
          onSelect={handleKindSelect}
        />
      ) : null}

      {step === 1 ? (
        <CatalogCreationBasicsStep
          artistOptions={artistOptions}
          onArtistChange={handleArtistChange}
          onGenreChange={handleGenreChange}
          onLabelChange={handleLabelChange}
          onMerchandiseTypeChange={handleMerchandiseTypeChange}
          onProductTypeChange={handleProductTypeChange}
          onReleaseDatePrecisionChange={handleReleaseDatePrecisionChange}
          onTextChange={handleTextChange}
          onVocabularyRetry={handleVocabularyRetry}
          referenceOptions={referenceOptions}
          values={values}
          vocabularyLoading={vocabularyLoading}
          vocabularyUnavailable={vocabularyUnavailable}
        />
      ) : null}

      {step === 2 ? (
        <CatalogCreationOfferingsStep
          availabilityByOfferingId={availabilityByOfferingId}
          choicesData={choicesData}
          choicesError={choicesQuery.error}
          choicesFetching={choicesQuery.isFetching}
          choicesIsError={choicesQuery.isError}
          choicesPending={choicesQuery.isPending}
          onAddBundleComponent={addBundleComponent}
          onAddOffering={addOffering}
          onApplyMerchandiseTemplate={applyMerchandiseTemplate}
          onChoicesRetry={handleChoicesRetry}
          onRemoveBundleComponent={removeBundleComponent}
          onRemoveOffering={removeOffering}
          onUpdateBundleComponent={updateBundleComponent}
          onUpdateBundleMapping={updateBundleMapping}
          onUpdateOffering={updateOffering}
          values={values}
        />
      ) : null}

      {step === 3 ? (
        <CatalogCreationDetailsStep
          onMediaChange={handleMediaChange}
          onTextChange={handleTextChange}
          onUploadingChange={setMediaUploading}
          values={values}
        />
      ) : null}

      {step === 4 ? (
        <CatalogCreationReviewStep
          availabilityByOfferingId={availabilityByOfferingId}
          onChangeStep={handleChangeStep}
          values={values}
        />
      ) : null}

      <CatalogCreationActions
        busy={busy}
        currentStep={step}
        onBack={handleBack}
        onCancel={handleCancel}
        onNext={handleNext}
        onSave={handleSave}
      />

      <ConfirmAction
        confirmLabel="Clear draft"
        description={
          values.media.length
            ? "This resets every field. No Medusa product has been created; uploaded images remain in Media Cleanup for safe review."
            : "This removes the saved browser draft and resets every field. No Medusa product has been created."
        }
        onCancel={handleClearDraftCancel}
        onConfirm={handleClearDraftConfirm}
        open={clearOpen}
        title="Clear this draft?"
        variant="danger"
      />

      <ConfirmAction
        confirmLabel="Leave creation"
        description={
          values.media.length
            ? "Your browser draft is saved for seven days. The product has not been created; uploaded images remain managed and can be reviewed in Media Cleanup."
            : "Your browser draft is saved for seven days, but the product has not been created in Medusa."
        }
        onCancel={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        open={leaveOpen}
        title="Leave this draft?"
        variant="danger"
      />
    </div>
  )
})

CatalogProductCreatePageContent.displayName = "CatalogProductCreatePageContent"

export const CatalogProductCreatePage = memo(() => (
  <AdminPermissionBoundary
    actions={catalogProductCreateActions}
    workspace="Catalog product creation"
  >
    <CatalogProductCreatePageContent />
  </AdminPermissionBoundary>
))

CatalogProductCreatePage.displayName = "CatalogProductCreatePage"
