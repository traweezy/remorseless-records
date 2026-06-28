"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox, Trash } from "@medusajs/icons"
import {
  Button,
  Container,
  FocusModal,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"

const shelfModes = ["manual", "automatic", "hybrid"] as const
const automationTypes = ["none", "new_release"] as const

type ShelfMode = (typeof shelfModes)[number]
type AutomationType = (typeof automationTypes)[number]

type ValueChangeEvent = {
  target?: EventTarget | null
  currentTarget?: EventTarget | null
}

type AdminProduct = {
  id: string
  title?: string | null
  handle?: string | null
  thumbnail?: string | null
}

type CatalogShelf = {
  id: string
  handle: string
  title: string
  description: string | null
  mode: ShelfMode
  automationType: AutomationType
  showRibbon: boolean
  ribbonLabel: string | null
  ribbonPriority: number
  productLimit: number | null
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
}

type CatalogShelfProduct = {
  id: string
  shelfId: string
  productId: string
  productProfileId: string | null
  sortOrder: number
  isPinned: boolean
  startsAt: string | null
  endsAt: string | null
}

type ShelfResponse = {
  shelf: CatalogShelf
  products: CatalogShelfProduct[]
}

type ShelfFormState = {
  title: string
  handle: string
  description: string
  mode: ShelfMode
  automationType: AutomationType
  showRibbon: boolean
  ribbonLabel: string
  ribbonPriority: string
  productLimit: string
  startsAt: string
  endsAt: string
  isActive: boolean
  products: ShelfProductLine[]
}

type ShelfProductLine = {
  key: string
  productId: string
  sortOrder: string
  isPinned: boolean
  startsAt: string
  endsAt: string
}

type CreateShelfState = {
  title: string
  handle: string
  mode: ShelfMode
  automationType: AutomationType
  showRibbon: boolean
  ribbonLabel: string
  ribbonPriority: string
  productLimit: string
}

const emptyShelfForm: ShelfFormState = {
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

const readValue = (event: ValueChangeEvent): string => {
  const target = event.currentTarget ?? event.target
  const value = (target as { value?: unknown } | null)?.value
  return typeof value === "string" ? value : ""
}

const readChecked = (event: ValueChangeEvent): boolean => {
  const target = event.currentTarget ?? event.target
  return Boolean((target as { checked?: unknown } | null)?.checked)
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

const ProductLabel = memo<{
  product: AdminProduct | undefined
  fallback: string
}>(({ product, fallback }) => (
  <div className="flex min-w-0 flex-col">
    <Text size="small" className="truncate">
      {product?.title ?? fallback}
    </Text>
    <Text size="xsmall" className="truncate text-ui-fg-subtle">
      {product?.handle ? `/${product.handle}` : product?.id ?? fallback}
    </Text>
  </div>
))

ProductLabel.displayName = "ProductLabel"

const ProductSelect = memo<{
  id: string
  products: AdminProduct[]
  value: string
  onChange: (value: string) => void
}>(({ id, products, value, onChange }) => (
  <select
    id={id}
    value={value}
    onChange={(event) => {
      onChange(readValue(event))
    }}
    className="bg-ui-bg-field shadow-borders-base txt-compact-small min-h-8 rounded-md px-2 outline-none"
  >
    <option value="">Select product</option>
    {products.map((product) => (
      <option key={product.id} value={product.id}>
        {product.title ?? product.id}
      </option>
    ))}
  </select>
))

ProductSelect.displayName = "ProductSelect"

const CatalogMerchandisingPage = memo(() => {
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [shelves, setShelves] = useState<ShelfResponse[]>([])
  const [selectedShelfId, setSelectedShelfId] = useState<string>("")
  const [formState, setFormState] = useState<ShelfFormState>(emptyShelfForm)
  const [createForm, setCreateForm] =
    useState<CreateShelfState>(emptyCreateShelfForm)
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const productById = useMemo(() => {
    const map = new Map<string, AdminProduct>()
    products.forEach((product) => {
      map.set(product.id, product)
    })
    return map
  }, [products])

  const selectedShelf = useMemo(
    () => shelves.find((entry) => entry.shelf.id === selectedShelfId) ?? null,
    [selectedShelfId, shelves]
  )

  const refreshProducts = useCallback(async () => {
    const response = await fetchJson<{ products: AdminProduct[] }>(
      "/admin/products?limit=200"
    )
    setProducts(response.products ?? [])
  }, [])

  const refreshShelves = useCallback(async () => {
    const response = await fetchJson<{ shelves: ShelfResponse[] }>(
      "/admin/catalog/shelves?limit=100"
    )
    setShelves(response.shelves ?? [])
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([refreshProducts(), refreshShelves()])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load shelves")
    } finally {
      setLoading(false)
    }
  }, [refreshProducts, refreshShelves])

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
    (field: keyof Omit<ShelfFormState, "products">) =>
      (value: string | boolean) => {
        setFormState((prev) => ({ ...prev, [field]: value }))
      },
    []
  )

  const updateCreateField = useCallback(
    (field: keyof CreateShelfState) => (value: string | boolean) => {
      setCreateForm((prev) => {
        const next = { ...prev, [field]: value }
        if (field === "title" && !prev.handle.trim() && typeof value === "string") {
          next.handle = defaultHandle(value)
        }
        if (field === "mode" && value === "automatic") {
          next.automationType = "new_release"
        }
        return next
      })
    },
    []
  )

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
      await fetchJson<ShelfResponse>(`/admin/catalog/shelves/${selectedShelfId}`, {
        method: "PUT",
        body: JSON.stringify({
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
        }),
      })

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
      const response = await fetchJson<ShelfResponse>("/admin/catalog/shelves", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      })

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
      })
      await refreshShelves()
      setSelectedShelfId("")
      setFormState(emptyShelfForm)
      setNotice("Deleted merchandising shelf.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete shelf")
    } finally {
      setSaving(false)
    }
  }, [refreshShelves, selectedShelfId])

  return (
    <Container className="flex flex-col gap-y-6 p-0">
      <div className="flex flex-col gap-3 border-b border-ui-border-base px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <Heading level="h1">Catalog merchandising</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Manage homepage shelves and catalog ribbons separately from product
            taxonomy.
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void refreshAll()
            }}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() => {
              setCreateOpen(true)
            }}
          >
            New shelf
          </Button>
        </div>
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

      <div className="grid gap-6 px-6 pb-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <div className="rounded-lg border border-ui-border-base">
          <div className="border-b border-ui-border-base px-4 py-3">
            <Heading level="h2">Shelves</Heading>
          </div>
          <Table>
            <Table.Body>
              {shelves.map((entry) => (
                <Table.Row
                  key={entry.shelf.id}
                  className={
                    entry.shelf.id === selectedShelfId ? "bg-ui-bg-subtle" : ""
                  }
                  onClick={() => {
                    setSelectedShelfId(entry.shelf.id)
                  }}
                >
                  <Table.Cell>
                    <div className="flex flex-col gap-1">
                      <Text size="small" className="font-medium">
                        {entry.shelf.title}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {entry.shelf.mode}
                        {entry.shelf.automationType !== "none"
                          ? ` / ${entry.shelf.automationType}`
                          : ""}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {entry.products.length} products
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
              {!shelves.length ? (
                <Table.Row>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      No shelves yet.
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table>
        </div>

        {selectedShelf ? (
          <div className="flex flex-col gap-6">
            <div className="rounded-lg border border-ui-border-base">
              <div className="flex flex-col gap-3 border-b border-ui-border-base px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <Heading level="h2">{selectedShelf.shelf.title}</Heading>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    /{selectedShelf.shelf.handle}
                  </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={deleteSelectedShelf}
                    disabled={saving}
                  >
                    <Trash />
                    Delete
                  </Button>
                  <Button type="button" onClick={saveShelf} disabled={saving}>
                    {saving ? "Saving..." : "Save shelf"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="shelf-title">Title</Label>
                  <Input
                    id="shelf-title"
                    value={formState.title}
                    onChange={(event) => {
                      updateField("title")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-handle">Handle</Label>
                  <Input
                    id="shelf-handle"
                    value={formState.handle}
                    onChange={(event) => {
                      updateField("handle")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="shelf-description">Description</Label>
                  <Textarea
                    id="shelf-description"
                    value={formState.description}
                    onChange={(event) => {
                      updateField("description")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-mode">Mode</Label>
                  <select
                    id="shelf-mode"
                    value={formState.mode}
                    onChange={(event) => {
                      const value = readValue(event) as ShelfMode
                      updateField("mode")(value)
                      if (value === "automatic") {
                        updateField("automationType")("new_release")
                      }
                    }}
                    className="bg-ui-bg-field shadow-borders-base txt-compact-small min-h-8 w-full rounded-md px-2 outline-none"
                  >
                    {shelfModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-automation">Automation</Label>
                  <select
                    id="shelf-automation"
                    value={formState.automationType}
                    onChange={(event) => {
                      updateField("automationType")(readValue(event))
                    }}
                    className="bg-ui-bg-field shadow-borders-base txt-compact-small min-h-8 w-full rounded-md px-2 outline-none"
                  >
                    {automationTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-limit">Product limit</Label>
                  <Input
                    id="shelf-limit"
                    type="number"
                    min="1"
                    value={formState.productLimit}
                    onChange={(event) => {
                      updateField("productLimit")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-priority">Ribbon priority</Label>
                  <Input
                    id="shelf-priority"
                    type="number"
                    min="0"
                    value={formState.ribbonPriority}
                    onChange={(event) => {
                      updateField("ribbonPriority")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-ribbon-label">Ribbon label</Label>
                  <Input
                    id="shelf-ribbon-label"
                    value={formState.ribbonLabel}
                    onChange={(event) => {
                      updateField("ribbonLabel")(readValue(event))
                    }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-ui-fg-base">
                    <input
                      type="checkbox"
                      checked={formState.showRibbon}
                      onChange={(event) => {
                        updateField("showRibbon")(readChecked(event))
                      }}
                    />
                    <Text size="small">Show catalog ribbon</Text>
                  </label>
                  <label className="flex items-center gap-2 text-ui-fg-base">
                    <input
                      type="checkbox"
                      checked={formState.isActive}
                      onChange={(event) => {
                        updateField("isActive")(readChecked(event))
                      }}
                    />
                    <Text size="small">Active</Text>
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-start">Starts at</Label>
                  <Input
                    id="shelf-start"
                    type="datetime-local"
                    value={formState.startsAt}
                    onChange={(event) => {
                      updateField("startsAt")(readValue(event))
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelf-end">Ends at</Label>
                  <Input
                    id="shelf-end"
                    type="datetime-local"
                    value={formState.endsAt}
                    onChange={(event) => {
                      updateField("endsAt")(readValue(event))
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-ui-border-base">
              <div className="flex items-center justify-between gap-3 border-b border-ui-border-base px-4 py-3">
                <div>
                  <Heading level="h3">Products</Heading>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Manual rows can pin or reorder shelf output.
                  </Text>
                </div>
                <Button type="button" variant="secondary" onClick={addProductLine}>
                  Add product
                </Button>
              </div>
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Product</Table.HeaderCell>
                    <Table.HeaderCell>Order</Table.HeaderCell>
                    <Table.HeaderCell>Pinned</Table.HeaderCell>
                    <Table.HeaderCell></Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {formState.products.map((line, index) => (
                    <Table.Row key={line.key}>
                      <Table.Cell className="min-w-[260px]">
                        <div className="flex flex-col gap-2">
                          <ProductSelect
                            id={`shelf-product-${line.key}`}
                            products={products}
                            value={line.productId}
                            onChange={(value) => {
                              updateProductLine(line.key, { productId: value })
                            }}
                          />
                          {line.productId ? (
                            <ProductLabel
                              product={productById.get(line.productId)}
                              fallback={line.productId}
                            />
                          ) : null}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Input
                          type="number"
                          min="0"
                          value={line.sortOrder}
                          onChange={(event) => {
                            updateProductLine(line.key, {
                              sortOrder: readValue(event),
                            })
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <input
                          type="checkbox"
                          checked={line.isPinned}
                          onChange={(event) => {
                            updateProductLine(line.key, {
                              isPinned: readChecked(event),
                            })
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              moveProductLine(line.key, -1)
                            }}
                            disabled={index === 0}
                          >
                            Up
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              moveProductLine(line.key, 1)
                            }}
                            disabled={index === formState.products.length - 1}
                          >
                            Down
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              removeProductLine(line.key)
                            }}
                          >
                            <Trash />
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                  {!formState.products.length ? (
                    <Table.Row>
                      <Table.Cell>
                        <Text size="small" className="text-ui-fg-subtle">
                          No manual products in this shelf.
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                </Table.Body>
              </Table>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-ui-border-base p-8 text-center">
            <Heading level="h2">No shelf selected</Heading>
            <Text size="small" className="mt-2 text-ui-fg-subtle">
              Create or select a merchandising shelf.
            </Text>
          </div>
        )}
      </div>

      <FocusModal open={createOpen} onOpenChange={setCreateOpen}>
        <FocusModal.Content className="max-w-3xl sm:inset-y-8 sm:inset-x-1/2 sm:-translate-x-1/2 sm:w-full">
          <FocusModal.Header>
            <FocusModal.Title>Create merchandising shelf</FocusModal.Title>
          </FocusModal.Header>
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-shelf-title">Title</Label>
                <Input
                  id="new-shelf-title"
                  value={createForm.title}
                  onChange={(event) => {
                    updateCreateField("title")(readValue(event))
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-handle">Handle</Label>
                <Input
                  id="new-shelf-handle"
                  value={createForm.handle}
                  onChange={(event) => {
                    updateCreateField("handle")(readValue(event))
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-mode">Mode</Label>
                <select
                  id="new-shelf-mode"
                  value={createForm.mode}
                  onChange={(event) => {
                    updateCreateField("mode")(readValue(event) as ShelfMode)
                  }}
                  className="bg-ui-bg-field shadow-borders-base txt-compact-small min-h-8 w-full rounded-md px-2 outline-none"
                >
                  {shelfModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-automation">Automation</Label>
                <select
                  id="new-shelf-automation"
                  value={createForm.automationType}
                  onChange={(event) => {
                    updateCreateField("automationType")(
                      readValue(event) as AutomationType
                    )
                  }}
                  className="bg-ui-bg-field shadow-borders-base txt-compact-small min-h-8 w-full rounded-md px-2 outline-none"
                >
                  {automationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-priority">Ribbon priority</Label>
                <Input
                  id="new-shelf-priority"
                  type="number"
                  min="0"
                  value={createForm.ribbonPriority}
                  onChange={(event) => {
                    updateCreateField("ribbonPriority")(readValue(event))
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-limit">Product limit</Label>
                <Input
                  id="new-shelf-limit"
                  type="number"
                  min="1"
                  value={createForm.productLimit}
                  onChange={(event) => {
                    updateCreateField("productLimit")(readValue(event))
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-shelf-ribbon">Ribbon label</Label>
                <Input
                  id="new-shelf-ribbon"
                  value={createForm.ribbonLabel}
                  onChange={(event) => {
                    updateCreateField("ribbonLabel")(readValue(event))
                  }}
                />
              </div>
              <label className="flex items-center gap-2 pt-7 text-ui-fg-base">
                <input
                  type="checkbox"
                  checked={createForm.showRibbon}
                  onChange={(event) => {
                    updateCreateField("showRibbon")(readChecked(event))
                  }}
                />
                <Text size="small">Show catalog ribbon</Text>
              </label>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <FocusModal.Close asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </FocusModal.Close>
            <Button type="button" onClick={createShelf} disabled={saving}>
              {saving ? "Creating..." : "Create shelf"}
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </Container>
  )
})

CatalogMerchandisingPage.displayName = "CatalogMerchandisingPage"

export const config = defineRouteConfig({
  label: "Catalog Merchandising",
  icon: ArchiveBox,
})

export default CatalogMerchandisingPage
