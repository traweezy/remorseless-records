"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Text,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"

import {
  adminPermissionKey,
  catalogAdminActions,
} from "../../../lib/admin-permissions"
import { AdminEmptyState } from "../../components/admin-empty-state"
import { AdminPageHeader } from "../../components/admin-page"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { ConfirmAction } from "../../components/confirm-action"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
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
  type AdminProduct,
  type CreateShelfState,
  type ShelfFormState,
  type ShelfProductLine,
  type ShelfResponse,
} from "../../features/catalog-merchandising/catalog-merchandising-types"

const emptyShelfForm: ShelfFormState = {
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
}

const emptyCreateShelfForm: CreateShelfState = {
  title: "",
  handle: "",
  mode: "manual",
  automationType: "none",
  showRibbon: false,
  ribbonLabel: "",
  ribbonPriority: "100",
  productLimit: "",
}

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
  payload: Record<string, unknown>,
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

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: string; error?: string }
    return body.message ?? body.error ?? response.statusText
  } catch {
    return response.statusText
  }
}

const fetchJson = async <T,>(
  url: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

const toShelfForm = (response: ShelfResponse | null): ShelfFormState => {
  if (!response) {
    return emptyShelfForm
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
    productLimit: response.shelf.productLimit ? String(response.shelf.productLimit) : "",
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
  const [pickedProducts, setPickedProducts] = useState<Map<string, AdminProduct>>(
    () => new Map(),
  )
  const [selectedShelfId, setSelectedShelfId] = useState<string>("")
  const [formState, setFormState] = useState<ShelfFormState>(emptyShelfForm)
  const [createForm, setCreateForm] =
    useState<CreateShelfState>(emptyCreateShelfForm)
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const saveRequest = useRef<PendingRequest | null>(null)
  const createRequest = useRef<PendingRequest | null>(null)
  const archiveRequest = useRef<PendingRequest | null>(null)
  const restoreRequest = useRef<PendingRequest | null>(null)

  const selectedProductIds = useMemo(
    () =>
      formState.products
        .map((line) => line.productId)
        .filter((productId) => productId.length > 0),
    [formState.products],
  )
  const selectedProductsQuery = useQuery(
    catalogSelectedProductsQueryOptions(selectedProductIds),
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
    const response = await fetchJson<{ shelves: ShelfResponse[] }>(
      "/admin/catalog/shelves?limit=100&archived=all"
    )
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

  const loadShelf = useCallback(async (shelfId: string) => {
    if (!shelfId) {
      setFormState(emptyShelfForm)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetchJson<ShelfResponse>(
        `/admin/catalog/shelves/${shelfId}`
      )
      setPickedProducts(new Map())
      setFormState(toShelfForm(response))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load shelf")
    } finally {
      setLoading(false)
    }
  }, [])

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
      setFormState((prev) => {
        const next = { ...prev, [field]: value } as ShelfFormState
        if (field === "mode" && value === "automatic") {
          next.automationType = "new_release"
        }
        return next
      })
    },
    [],
  )

  const updateCreateField = useCallback(
    (field: CreateShelfField, value: string | boolean) => {
      setCreateForm((prev) => {
        const next = { ...prev, [field]: value } as CreateShelfState
        if (field === "title" && !prev.handle.trim() && typeof value === "string") {
          next.handle = defaultHandle(value)
        }
        if (field === "mode" && value === "automatic") {
          next.automationType = "new_release"
        }
        return next
      })
    },
    [],
  )

  const handleShelfSelect = useCallback((shelfId: string) => {
    setSelectedShelfId(shelfId)
  }, [])

  const updateProductLine = useCallback(
    (key: string, patch: Partial<ShelfProductLine>) => {
      setFormState((prev) => ({
        ...prev,
        products: prev.products.map((line) =>
          line.key === key ? { ...line, ...patch } : line
        ),
      }))
    },
    []
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
    [updateProductLine],
  )

  const retrySelectedProducts = useCallback(() => {
    void selectedProductsQuery.refetch()
  }, [selectedProductsQuery])

  const addProductLine = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      products: [
        ...prev.products,
        {
          key: buildKey("shelf-product"),
          productId: "",
          sortOrder: String(prev.products.length),
          isPinned: false,
          startsAt: "",
          endsAt: "",
        },
      ],
    }))
  }, [])

  const removeProductLine = useCallback((key: string) => {
    setFormState((prev) => ({
      ...prev,
      products: sortShelfLines(prev.products.filter((line) => line.key !== key)),
    }))
  }, [])

  const moveProductLine = useCallback((key: string, direction: -1 | 1) => {
    setFormState((prev) => {
      const index = prev.products.findIndex((line) => line.key === key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.products.length) {
        return prev
      }
      const next = [...prev.products]
      const line = next[index]
      if (!line) {
        return prev
      }
      next.splice(index, 1)
      next.splice(target, 0, line)
      return { ...prev, products: sortShelfLines(next) }
    })
  }, [])

  const saveShelf = useCallback(async () => {
    if (!selectedShelfId) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const ribbonPriority = toIntegerOrNull(formState.ribbonPriority) ?? 100
      const productLimit = toIntegerOrNull(formState.productLimit)
      if (formState.mode === "automatic" && formState.automationType === "none") {
        throw new Error("Automatic shelves need an automation type.")
      }

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
      await fetchJson<ShelfResponse>(`/admin/catalog/shelves/${selectedShelfId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: idempotencyKeyFor(saveRequest, payload),
        }),
      })

      saveRequest.current = null
      await refreshShelves()
      await loadShelf(selectedShelfId)
      setNotice("Saved merchandising shelf.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save shelf")
    } finally {
      setSaving(false)
    }
  }, [formState, loadShelf, refreshShelves, selectedShelfId])

  const createShelf = useCallback(async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const title = createForm.title.trim()
      if (!title) {
        throw new Error("Shelf title is required.")
      }
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
      const response = await fetchJson<ShelfResponse>("/admin/catalog/shelves", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: idempotencyKeyFor(createRequest, payload),
        }),
      })

      createRequest.current = null
      await refreshShelves()
      setSelectedShelfId(response.shelf.id)
      setCreateForm(emptyCreateShelfForm)
      setCreateOpen(false)
      setNotice("Created merchandising shelf.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create shelf")
    } finally {
      setSaving(false)
    }
  }, [createForm, refreshShelves])

  const deleteSelectedShelf = useCallback(async () => {
    if (!selectedShelfId) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await fetchJson(`/admin/catalog/shelves/${selectedShelfId}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: formState.version,
          idempotencyKey: idempotencyKeyFor(archiveRequest, {
            expectedVersion: formState.version,
            shelfId: selectedShelfId,
          }),
        }),
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
      await fetchJson(`/admin/catalog/shelves/${selectedShelfId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: formState.version,
          idempotencyKey: idempotencyKeyFor(restoreRequest, payload),
        }),
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
    setCreateOpen(true)
  }, [])

  const selectedShelfArchived = Boolean(selectedShelf?.shelf.archivedAt)

  return (
    <Container className="flex flex-col gap-y-6 p-0">
      <div className="border-b border-ui-border-base px-6 py-5">
        <AdminPageHeader
          actions={
            <>
              <Button
                disabled={loading}
                onClick={handleRefresh}
                type="button"
                variant="secondary"
              >
                Refresh
              </Button>
              <Button ref={createTriggerRef} onClick={handleCreateOpen} type="button">
                New shelf
              </Button>
            </>
          }
          description="Build homepage shelves and catalog ribbons without changing product taxonomy."
          title="Catalog merchandising"
        />
      </div>

      {error ? (
        <div className="mx-6 rounded-md border border-ui-border-error bg-ui-bg-error px-4 py-3">
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-6 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
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
                      disabled={saving}
                    >
                      Restore
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={openArchive}
                      disabled={saving}
                    >
                      <ArchiveBox />
                      Archive
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={saveShelf}
                    disabled={saving || Boolean(selectedShelf.shelf.archivedAt)}
                  >
                    {saving ? "Saving..." : "Save shelf"}
                  </Button>
                </div>
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

              <CatalogShelfSettings
                disabled={selectedShelfArchived}
                form={formState}
                onChange={updateField}
              />
            </div>

            <fieldset
              aria-label="Shelf products"
              className="min-w-0 rounded-lg border border-ui-border-base"
              disabled={selectedShelfArchived}
            >
              <CatalogShelfProductsEditor
                disabled={selectedShelfArchived}
                lines={formState.products}
                lookupError={
                  selectedProductsQuery.error
                    ? getAdminRequestErrorMessage(
                        selectedProductsQuery.error,
                        "Unable to load selected product details.",
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
        onChange={updateCreateField}
        onCreate={createShelf}
        onOpenChange={setCreateOpen}
        open={createOpen}
        restoreFocusRef={createTriggerRef}
        saving={saving}
      />
      <ConfirmAction
        confirmLabel="Archive shelf"
        description={
          <>
            Archive <strong>{selectedShelf?.shelf.title ?? "this shelf"}</strong>?
            It will be hidden from customers and retained for restoration.
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
