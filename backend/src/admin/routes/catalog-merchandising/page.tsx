"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox } from "@medusajs/icons"
import { Button, Container, Heading, Text, clx } from "@medusajs/ui"
import { useForm, useStore } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"

import {
  adminPermissionKey,
  catalogAdminActions,
} from "../../../lib/admin-permissions"
import { AdminEmptyState } from "../../components/admin-empty-state"
import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  AdminTaskNavigation,
  focusFirstAdminFormIssue,
  useAdminUnsavedChanges,
  type AdminFormIssue,
  type AdminSaveState,
  type AdminTaskNavigationItem,
} from "../../components/admin-form-contract"
import { AdminPageHeader } from "../../components/admin-page"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { ConfirmAction } from "../../components/confirm-action"
import {
  getAdminRequestErrorMessage,
  requestAdminJson,
} from "../../lib/admin-request"
import { catalogMerchandisingWorkspaceActions } from "../../features/catalog-permissions"
import {
  CatalogShelfCreateModal,
  type CreateShelfField,
} from "../../features/catalog-merchandising/catalog-shelf-create-modal"
import { CatalogShelfList } from "../../features/catalog-merchandising/catalog-shelf-list"
import { CatalogShelfProductsEditor } from "../../features/catalog-merchandising/catalog-shelf-products-editor"
import {
  CatalogShelfSettings,
  type ShelfSettingsField,
} from "../../features/catalog-merchandising/catalog-shelf-settings"
import { catalogSelectedProductsQueryOptions } from "../../features/catalog-merchandising/catalog-merchandising-query"
import {
  catalogShelfCreateSchema,
  catalogShelfCreateValidationIssues,
  catalogShelfFingerprint,
  catalogShelfFormSchema,
  catalogShelfValidationIssues,
} from "../../features/catalog-merchandising/catalog-merchandising-form"
import {
  emptyShelfResponseSchema,
  shelfListResponseSchema,
  shelfResponseSchema,
  type AdminProduct,
  type CreateShelfState,
  type ShelfFormState,
  type ShelfProductLine,
  type ShelfResponse,
} from "../../features/catalog-merchandising/catalog-merchandising-types"

const createEmptyShelfForm = (): ShelfFormState => ({
  version: 0,
  title: "",
  handle: "",
  description: "",
  mode: "manual",
  automationType: "none",
  showRibbon: false,
  ribbonLabel: "",
  ribbonPriority: "100",
  productLimit: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
  products: [],
})

const createEmptyCreateShelfForm = (): CreateShelfState => ({
  title: "",
  handle: "",
  mode: "manual",
  automationType: "none",
  showRibbon: false,
  ribbonLabel: "",
  ribbonPriority: "100",
  productLimit: "",
})

const merchandisingTasks = [
  { href: "#shelf-settings", label: "Storefront settings" },
  { href: "#shelf-products", label: "Products and schedule" },
] as const satisfies readonly AdminTaskNavigationItem[]

const buildKey = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`

const defaultHandle = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const toNullable = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

type PendingRequest = {
  fingerprint: string
  idempotencyKey: string
}

const idempotencyKeyFor = (
  pending: { current: PendingRequest | null },
  payload: Record<string, unknown>
): string => {
  const fingerprint = JSON.stringify(payload)
  if (pending.current?.fingerprint === fingerprint) {
    return pending.current.idempotencyKey
  }
  const idempotencyKey = crypto.randomUUID()
  pending.current = { fingerprint, idempotencyKey }
  return idempotencyKey
}

const toDateTimeInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return date.toISOString().slice(0, 16)
}

const toShelfForm = (response: ShelfResponse | null): ShelfFormState => {
  if (!response) {
    return createEmptyShelfForm()
  }

  return {
    version: response.shelf.version,
    title: response.shelf.title ?? "",
    handle: response.shelf.handle ?? "",
    description: response.shelf.description ?? "",
    mode: response.shelf.mode ?? "manual",
    automationType: response.shelf.automationType ?? "none",
    showRibbon: response.shelf.showRibbon ?? false,
    ribbonLabel: response.shelf.ribbonLabel ?? "",
    ribbonPriority: String(response.shelf.ribbonPriority ?? 100),
    productLimit: response.shelf.productLimit
      ? String(response.shelf.productLimit)
      : "",
    startsAt: toDateTimeInput(response.shelf.startsAt),
    endsAt: toDateTimeInput(response.shelf.endsAt),
    isActive: response.shelf.isActive ?? true,
    products: response.products.map((product) => ({
      key: buildKey("shelf-product"),
      productId: product.productId,
      sortOrder: String(product.sortOrder ?? 0),
      isPinned: product.isPinned ?? false,
      startsAt: toDateTimeInput(product.startsAt),
      endsAt: toDateTimeInput(product.endsAt),
    })),
  }
}

const toIntegerOrNull = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed)) {
    throw new Error("Expected a whole number.")
  }

  return parsed
}

const sortShelfLines = (lines: ShelfProductLine[]): ShelfProductLine[] =>
  lines.map((line, index) => ({ ...line, sortOrder: String(index) }))

const CatalogMerchandisingPageContent = memo(() => {
  const [shelves, setShelves] = useState<ShelfResponse[]>([])
  const [pickedProducts, setPickedProducts] = useState<
    Map<string, AdminProduct>
  >(() => new Map())
  const [selectedShelfId, setSelectedShelfId] = useState<string>("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createDiscardOpen, setCreateDiscardOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [pendingShelfId, setPendingShelfId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formIssues, setFormIssues] = useState<AdminFormIssue[]>([])
  const [createIssues, setCreateIssues] = useState<AdminFormIssue[]>([])
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const saveRequest = useRef<PendingRequest | null>(null)
  const createRequest = useRef<PendingRequest | null>(null)
  const archiveRequest = useRef<PendingRequest | null>(null)
  const restoreRequest = useRef<PendingRequest | null>(null)
  const shelfDefaultValues = useMemo(createEmptyShelfForm, [])
  const createShelfDefaultValues = useMemo(createEmptyCreateShelfForm, [])

  const shelfForm = useForm({
    defaultValues: shelfDefaultValues,
    validators: { onChange: catalogShelfFormSchema },
  })
  const shelfFormState = useStore(shelfForm.store, (state) => ({
    isDirty: state.isDirty,
    values: state.values,
  }))
  const formState = shelfFormState.values
  const createShelfForm = useForm({
    defaultValues: createShelfDefaultValues,
    validators: { onChange: catalogShelfCreateSchema },
  })
  const createFormState = useStore(createShelfForm.store, (state) => ({
    isDirty: state.isDirty,
    values: state.values,
  }))
  const createForm = createFormState.values

  const selectedProductIds = useMemo(
    () =>
      formState.products
        .map((line) => line.productId)
        .filter((productId) => productId.length > 0),
    [formState.products]
  )
  const selectedProductsQuery = useQuery(
    catalogSelectedProductsQueryOptions(selectedProductIds)
  )
  const productById = useMemo(() => {
    const map = new Map<string, AdminProduct>()
    selectedProductsQuery.data?.forEach((product) => {
      map.set(product.id, product)
    })
    pickedProducts.forEach((product) => {
      map.set(product.id, product)
    })
    return map
  }, [pickedProducts, selectedProductsQuery.data])

  const selectedShelf = useMemo(
    () => shelves.find((entry) => entry.shelf.id === selectedShelfId) ?? null,
    [selectedShelfId, shelves]
  )

  const refreshShelves = useCallback(async () => {
    const response = await requestAdminJson({
      path: "/admin/catalog/shelves?limit=100&archived=all",
      schema: shelfListResponseSchema,
    })
    setShelves(response.shelves ?? [])
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await refreshShelves()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load shelves")
    } finally {
      setLoading(false)
    }
  }, [refreshShelves])

  const loadShelf = useCallback(
    async (shelfId: string) => {
      if (!shelfId) {
        shelfForm.reset(createEmptyShelfForm(), { keepDefaultValues: true })
        setFormIssues([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const response = await requestAdminJson({
          path: `/admin/catalog/shelves/${shelfId}`,
          schema: shelfResponseSchema,
        })
        setPickedProducts(new Map())
        shelfForm.reset(toShelfForm(response), { keepDefaultValues: true })
        setFormIssues([])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load shelf")
      } finally {
        setLoading(false)
      }
    },
    [shelfForm]
  )

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const firstShelf = shelves.at(0)
    if (!selectedShelfId && firstShelf) {
      setSelectedShelfId(firstShelf.shelf.id)
    }
  }, [selectedShelfId, shelves])

  useEffect(() => {
    void loadShelf(selectedShelfId)
  }, [loadShelf, selectedShelfId])

  const updateField = useCallback(
    (field: ShelfSettingsField, value: string | boolean) => {
      shelfForm.setFieldValue(field as never, value as never)
      if (field === "mode" && value === "automatic") {
        shelfForm.setFieldValue("automationType", "new_release")
      }
      setFormIssues([])
    },
    [shelfForm]
  )

  const updateCreateField = useCallback(
    (field: CreateShelfField, value: string | boolean) => {
      const current = createShelfForm.state.values
      createShelfForm.setFieldValue(field as never, value as never)
      if (
        field === "title" &&
        (!current.handle.trim() ||
          current.handle === defaultHandle(current.title)) &&
        typeof value === "string"
      ) {
        createShelfForm.setFieldValue("handle", defaultHandle(value))
      }
      if (field === "mode" && value === "automatic") {
        createShelfForm.setFieldValue("automationType", "new_release")
      }
      setCreateIssues([])
    },
    [createShelfForm]
  )

  const handleShelfSelect = useCallback(
    (shelfId: string) => {
      if (shelfId === selectedShelfId) {
        return
      }
      if (shelfFormState.isDirty) {
        setPendingShelfId(shelfId)
        setSwitchOpen(true)
        return
      }
      setSelectedShelfId(shelfId)
    },
    [selectedShelfId, shelfFormState.isDirty]
  )

  const updateProductLine = useCallback(
    (key: string, patch: Partial<ShelfProductLine>) => {
      shelfForm.setFieldValue("products", (products) =>
        products.map((line) =>
          line.key === key ? { ...line, ...patch } : line
        )
      )
      setFormIssues([])
    },
    [shelfForm]
  )

  const selectProduct = useCallback(
    (key: string, product: AdminProduct) => {
      updateProductLine(key, { productId: product.id })
      setPickedProducts((current) => {
        const next = new Map(current)
        next.set(product.id, product)
        return next
      })
    },
    [updateProductLine]
  )

  const retrySelectedProducts = useCallback(() => {
    void selectedProductsQuery.refetch()
  }, [selectedProductsQuery])

  const addProductLine = useCallback(() => {
    shelfForm.setFieldValue("products", (products) => [
      ...products,
      {
        key: buildKey("shelf-product"),
        productId: "",
        sortOrder: String(products.length),
        isPinned: false,
        startsAt: "",
        endsAt: "",
      },
    ])
    setFormIssues([])
  }, [shelfForm])

  const removeProductLine = useCallback(
    (key: string) => {
      shelfForm.setFieldValue("products", (products) =>
        sortShelfLines(products.filter((line) => line.key !== key))
      )
      setFormIssues([])
    },
    [shelfForm]
  )

  const moveProductLine = useCallback(
    (key: string, direction: -1 | 1) => {
      shelfForm.setFieldValue("products", (products) => {
        const index = products.findIndex((line) => line.key === key)
        const target = index + direction
        if (index < 0 || target < 0 || target >= products.length) {
          return products
        }
        const next = [...products]
        const line = next[index]
        if (!line) {
          return products
        }
        next.splice(index, 1)
        next.splice(target, 0, line)
        return sortShelfLines(next)
      })
      setFormIssues([])
    },
    [shelfForm]
  )

  const saveShelf = useCallback(async () => {
    if (!selectedShelfId) {
      return
    }

    const issues = catalogShelfValidationIssues(formState)
    if (issues.length > 0) {
      setFormIssues(issues)
      focusFirstAdminFormIssue(issues)
      setError(null)
      setNotice(null)
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    setFormIssues([])
    const desiredFingerprint = catalogShelfFingerprint(formState)
    try {
      const ribbonPriority = toIntegerOrNull(formState.ribbonPriority) ?? 100
      const productLimit = toIntegerOrNull(formState.productLimit)

      const productLines = formState.products.filter((line) => line.productId)
      const payload = {
        expectedVersion: formState.version,
        title: formState.title.trim(),
        handle: formState.handle.trim(),
        description: toNullable(formState.description),
        mode: formState.mode,
        automationType: formState.automationType,
        showRibbon: formState.showRibbon,
        ribbonLabel: toNullable(formState.ribbonLabel),
        ribbonPriority,
        productLimit,
        startsAt: toNullable(formState.startsAt),
        endsAt: toNullable(formState.endsAt),
        isActive: formState.isActive,
        products: productLines.map((line, index) => ({
          productId: line.productId,
          sortOrder: Number.parseInt(line.sortOrder, 10) || index,
          isPinned: line.isPinned,
          startsAt: toNullable(line.startsAt),
          endsAt: toNullable(line.endsAt),
        })),
      }
      const response = await requestAdminJson({
        body: {
          ...payload,
          idempotencyKey: idempotencyKeyFor(saveRequest, payload),
        },
        method: "PUT",
        path: `/admin/catalog/shelves/${selectedShelfId}`,
        schema: shelfResponseSchema,
      })

      saveRequest.current = null
      await refreshShelves()
      shelfForm.reset(toShelfForm(response), { keepDefaultValues: true })
      setNotice("Saved merchandising shelf.")
    } catch (err) {
      const failureMessage =
        err instanceof Error ? err.message : "Unable to save shelf"
      setReconciling(true)
      try {
        const snapshot = await requestAdminJson({
          path: `/admin/catalog/shelves/${selectedShelfId}`,
          schema: shelfResponseSchema,
        })
        const snapshotForm = toShelfForm(snapshot)
        if (catalogShelfFingerprint(snapshotForm) === desiredFingerprint) {
          saveRequest.current = null
          shelfForm.reset(snapshotForm, { keepDefaultValues: true })
          await refreshShelves()
          setNotice(
            "Saved merchandising shelf; confirmed after checking the server."
          )
        } else {
          setError(
            `${failureMessage} The server did not confirm the complete change; your local edits are still available.`
          )
        }
      } catch {
        setError(failureMessage)
      } finally {
        setReconciling(false)
      }
    } finally {
      setSaving(false)
    }
  }, [formState, refreshShelves, selectedShelfId, shelfForm])

  const createShelf = useCallback(async () => {
    const issues = catalogShelfCreateValidationIssues(createForm)
    if (issues.length > 0) {
      setCreateIssues(issues)
      focusFirstAdminFormIssue(issues)
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    setCreateIssues([])
    try {
      const title = createForm.title.trim()
      const ribbonPriority = toIntegerOrNull(createForm.ribbonPriority) ?? 100
      const productLimit = toIntegerOrNull(createForm.productLimit)
      const payload = {
        expectedVersion: 0,
        title,
        handle: createForm.handle.trim() || defaultHandle(title),
        mode: createForm.mode,
        automationType: createForm.automationType,
        showRibbon: createForm.showRibbon,
        ribbonLabel: toNullable(createForm.ribbonLabel),
        ribbonPriority,
        productLimit,
        isActive: true,
        products: [],
      }
      const response = await requestAdminJson({
        body: {
          ...payload,
          idempotencyKey: idempotencyKeyFor(createRequest, payload),
        },
        method: "POST",
        path: "/admin/catalog/shelves",
        schema: shelfResponseSchema,
      })

      createRequest.current = null
      await refreshShelves()
      setSelectedShelfId(response.shelf.id)
      createShelfForm.reset(createEmptyCreateShelfForm(), {
        keepDefaultValues: true,
      })
      setCreateOpen(false)
      setNotice("Created merchandising shelf.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create shelf")
    } finally {
      setSaving(false)
    }
  }, [createForm, createShelfForm, refreshShelves])

  const deleteSelectedShelf = useCallback(async () => {
    if (!selectedShelfId) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await requestAdminJson({
        body: {
          expectedVersion: formState.version,
          idempotencyKey: idempotencyKeyFor(archiveRequest, {
            expectedVersion: formState.version,
            shelfId: selectedShelfId,
          }),
        },
        method: "DELETE",
        path: `/admin/catalog/shelves/${selectedShelfId}`,
        schema: emptyShelfResponseSchema,
      })
      archiveRequest.current = null
      await refreshShelves()
      await loadShelf(selectedShelfId)
      setArchiveOpen(false)
      setNotice("Archived merchandising shelf.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive shelf")
    } finally {
      setSaving(false)
    }
  }, [formState.version, loadShelf, refreshShelves, selectedShelfId])

  const openArchive = useCallback(() => {
    setArchiveOpen(true)
  }, [])

  const closeArchive = useCallback(() => {
    if (!saving) {
      setArchiveOpen(false)
    }
  }, [saving])

  const restoreSelectedShelf = useCallback(async () => {
    if (!selectedShelfId) {
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = {
        expectedVersion: formState.version,
        shelfId: selectedShelfId,
      }
      await requestAdminJson({
        body: {
          expectedVersion: formState.version,
          idempotencyKey: idempotencyKeyFor(restoreRequest, payload),
        },
        method: "POST",
        path: `/admin/catalog/shelves/${selectedShelfId}/restore`,
        schema: shelfResponseSchema,
      })
      restoreRequest.current = null
      await refreshShelves()
      await loadShelf(selectedShelfId)
      setNotice("Restored merchandising shelf as inactive.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to restore shelf")
    } finally {
      setSaving(false)
    }
  }, [formState.version, loadShelf, refreshShelves, selectedShelfId])

  const handleRefresh = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  const handleCreateOpen = useCallback(() => {
    createShelfForm.reset(createEmptyCreateShelfForm(), {
      keepDefaultValues: true,
    })
    setCreateIssues([])
    setCreateOpen(true)
  }, [createShelfForm])

  const handleCreateOpenChange = useCallback(
    (open: boolean) => {
      if (!open && createFormState.isDirty && !saving) {
        setCreateDiscardOpen(true)
        return
      }
      setCreateOpen(open)
    },
    [createFormState.isDirty, saving]
  )

  const cancelCreateDiscard = useCallback(() => {
    setCreateDiscardOpen(false)
  }, [])

  const confirmCreateDiscard = useCallback(() => {
    createShelfForm.reset(createEmptyCreateShelfForm(), {
      keepDefaultValues: true,
    })
    setCreateIssues([])
    setCreateDiscardOpen(false)
    setCreateOpen(false)
  }, [createShelfForm])

  const cancelShelfSwitch = useCallback(() => {
    setPendingShelfId(null)
    setSwitchOpen(false)
  }, [])

  const confirmShelfSwitch = useCallback(() => {
    if (pendingShelfId) {
      shelfForm.reset(formState, { keepDefaultValues: true })
      setSelectedShelfId(pendingShelfId)
    }
    setPendingShelfId(null)
    setSwitchOpen(false)
  }, [formState, pendingShelfId, shelfForm])

  const selectedShelfArchived = Boolean(selectedShelf?.shelf.archivedAt)
  const busy = loading || saving || reconciling
  const saveState: AdminSaveState = reconciling
    ? "reconciling"
    : saving
      ? "saving"
      : error
        ? "error"
        : shelfFormState.isDirty
          ? "dirty"
          : selectedShelf
            ? "saved"
            : "idle"
  const createSaveState: AdminSaveState = saving
    ? "saving"
    : createIssues.length > 0
      ? "error"
      : createFormState.isDirty
        ? "dirty"
        : "idle"

  useAdminUnsavedChanges(
    (shelfFormState.isDirty || (createOpen && createFormState.isDirty)) &&
      !saving &&
      !reconciling
  )

  return (
    <Container className="flex flex-col gap-y-6 p-0">
      <div className="border-b border-ui-border-base px-6 py-5">
        <AdminPageHeader
          actions={
            <>
              <Button
                disabled={busy || shelfFormState.isDirty}
                onClick={handleRefresh}
                type="button"
                variant="secondary"
              >
                Refresh
              </Button>
              <Button
                ref={createTriggerRef}
                onClick={handleCreateOpen}
                type="button"
              >
                New shelf
              </Button>
            </>
          }
          description="Build homepage shelves and catalog ribbons without changing product taxonomy."
          title="Catalog merchandising"
        />
      </div>

      {error ? (
        <div
          className="mx-6 rounded-md border border-ui-border-error bg-ui-bg-error px-4 py-3"
          role="alert"
        >
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      ) : null}
      {notice ? (
        <div
          aria-live="polite"
          className="mx-6 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3"
          role="status"
        >
          <Text size="small" className="text-ui-fg-subtle">
            {notice}
          </Text>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 px-6 pb-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg border border-ui-border-base">
          <div className="border-b border-ui-border-base px-4 py-3">
            <Heading level="h2">Shelves</Heading>
          </div>
          {shelves.length > 0 ? (
            <CatalogShelfList
              onSelect={handleShelfSelect}
              selectedShelfId={selectedShelfId}
              shelves={shelves}
            />
          ) : (
            <AdminEmptyState
              action={
                <Button onClick={handleCreateOpen} size="small" type="button">
                  Create a shelf
                </Button>
              }
              className="min-h-52"
              description="Create a shelf to feature products on the storefront."
              title="No merchandising shelves"
            />
          )}
        </div>

        {selectedShelf ? (
          <div className="min-w-0 flex flex-col gap-6">
            <div className="min-w-0 rounded-lg border border-ui-border-base">
              <div className="flex flex-col gap-3 border-b border-ui-border-base px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Heading level="h2">{selectedShelf.shelf.title}</Heading>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    /{selectedShelf.shelf.handle}
                  </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedShelf.shelf.archivedAt ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={restoreSelectedShelf}
                      disabled={busy || shelfFormState.isDirty}
                    >
                      Restore
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={openArchive}
                      disabled={busy || shelfFormState.isDirty}
                    >
                      <ArchiveBox />
                      Archive
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={saveShelf}
                    disabled={
                      busy ||
                      !shelfFormState.isDirty ||
                      Boolean(selectedShelf.shelf.archivedAt)
                    }
                    isLoading={saving || reconciling}
                  >
                    Save shelf
                  </Button>
                </div>
              </div>

              <div className="space-y-4 border-b border-ui-border-base px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Text className="text-ui-fg-subtle" size="small">
                    Configure what customers see, then add or schedule products.
                  </Text>
                  <AdminFormSaveState state={saveState} />
                </div>
                <AdminTaskNavigation
                  className={createOpen ? "invisible" : ""}
                  items={merchandisingTasks}
                />
                <AdminFormErrorSummary headingLevel="h3" issues={formIssues} />
              </div>

              {selectedShelf.shelf.archivedAt ? (
                <div className="border-b border-ui-border-base bg-ui-bg-subtle px-4 py-3">
                  <Text size="small" className="text-ui-fg-subtle">
                    This shelf is archived and read-only. Restore it to make
                    changes; restored shelves remain inactive until you choose
                    to publish them again.
                  </Text>
                </div>
              ) : null}

              <div
                className="scroll-mt-24 outline-none"
                id="shelf-settings"
                tabIndex={-1}
              >
                <CatalogShelfSettings
                  disabled={selectedShelfArchived}
                  form={formState}
                  onChange={updateField}
                />
              </div>
            </div>

            <fieldset
              aria-label="Shelf products"
              className="min-w-0 scroll-mt-24 rounded-lg border border-ui-border-base outline-none"
              disabled={selectedShelfArchived}
              id="shelf-products"
              tabIndex={-1}
            >
              <CatalogShelfProductsEditor
                disabled={selectedShelfArchived}
                lines={formState.products}
                lookupError={
                  selectedProductsQuery.error
                    ? getAdminRequestErrorMessage(
                        selectedProductsQuery.error,
                        "Unable to load selected product details."
                      )
                    : null
                }
                lookupRetrying={selectedProductsQuery.isFetching}
                onAdd={addProductLine}
                onChange={updateProductLine}
                onMove={moveProductLine}
                onProductSelect={selectProduct}
                onRemove={removeProductLine}
                onRetryLookup={retrySelectedProducts}
                productById={productById}
              />
            </fieldset>

            <div
              className={clx(
                "sticky bottom-4 z-10 flex flex-col gap-3 rounded-md border border-ui-border-base bg-ui-bg-base p-4 shadow-elevation-flyout sm:flex-row sm:items-center sm:justify-between",
                createOpen && "invisible"
              )}
            >
              <div>
                <Text className="font-medium" size="small">
                  {selectedShelf.shelf.title}
                </Text>
                <AdminFormSaveState state={saveState} />
              </div>
              <Button
                disabled={
                  busy ||
                  !shelfFormState.isDirty ||
                  Boolean(selectedShelf.shelf.archivedAt)
                }
                isLoading={saving || reconciling}
                onClick={saveShelf}
                type="button"
              >
                Save shelf
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-ui-border-base">
            <AdminEmptyState
              description="Create or choose a shelf to edit its customer-facing content."
              title="No shelf selected"
            />
          </div>
        )}
      </div>

      <CatalogShelfCreateModal
        form={createForm}
        issues={createIssues}
        onChange={updateCreateField}
        onCreate={createShelf}
        onOpenChange={handleCreateOpenChange}
        open={createOpen}
        restoreFocusRef={createTriggerRef}
        saveState={createSaveState}
        saving={saving}
      />
      <ConfirmAction
        confirmLabel="Discard draft"
        description="Discard this new shelf draft and close the editor?"
        onCancel={cancelCreateDiscard}
        onConfirm={confirmCreateDiscard}
        open={createDiscardOpen}
        title="Discard new shelf draft"
      />
      <ConfirmAction
        confirmLabel="Discard and switch"
        description="Discard the unsaved changes to this shelf and open the selected shelf?"
        onCancel={cancelShelfSwitch}
        onConfirm={confirmShelfSwitch}
        open={switchOpen}
        title="Switch shelves"
      />
      <ConfirmAction
        confirmLabel="Archive shelf"
        description={
          <>
            Archive{" "}
            <strong>{selectedShelf?.shelf.title ?? "this shelf"}</strong>? It
            will be hidden from customers and retained for restoration.
          </>
        }
        onCancel={closeArchive}
        onConfirm={deleteSelectedShelf}
        open={archiveOpen}
        pending={saving}
        pendingLabel="Archiving"
        title="Archive merchandising shelf"
      />
    </Container>
  )
})

CatalogMerchandisingPageContent.displayName = "CatalogMerchandisingPageContent"

export const CatalogMerchandisingPage = memo(() => (
  <AdminPermissionBoundary
    actions={catalogMerchandisingWorkspaceActions}
    workspace="Catalog Merchandising"
  >
    <CatalogMerchandisingPageContent />
  </AdminPermissionBoundary>
))

CatalogMerchandisingPage.displayName = "CatalogMerchandisingPage"

export const config = defineRouteConfig({
  label: "Catalog Merchandising",
  icon: ArchiveBox,
})

export const handle = {
  permissions: adminPermissionKey(catalogAdminActions.merchandising.read),
}

export default CatalogMerchandisingPage
