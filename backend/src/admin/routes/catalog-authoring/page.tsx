"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox, PencilSquare, Trash } from "@medusajs/icons"
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

import RichTextEditor from "../../components/rich-text-editor"

const productStatuses = ["draft", "published", "proposed", "rejected"] as const
const referenceKinds = [
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
] as const
const availabilityStatuses = [
  "available",
  "in_stock",
  "low_stock",
  "preorder",
  "backorder",
  "coming_soon",
  "sold_out",
  "unknown",
] as const
const bundleTypes = ["fixed", "mystery", "deal", "selectable"] as const
const bundleInventoryModes = ["component_derived", "manual"] as const
const bundleFulfillmentModes = ["ship_components", "manual"] as const
const productKinds = ["music_release", "merch", "fixed_bundle", "mystery_bundle"] as const

type ProductStatus = (typeof productStatuses)[number]
type ReferenceKind = (typeof referenceKinds)[number]
type AvailabilityStatus = (typeof availabilityStatuses)[number]
type BundleType = (typeof bundleTypes)[number]
type BundleInventoryMode = (typeof bundleInventoryModes)[number]
type BundleFulfillmentMode = (typeof bundleFulfillmentModes)[number]
type ProductKind = (typeof productKinds)[number]

type ValueChangeEvent = {
  target?: EventTarget | null
  currentTarget?: EventTarget | null
}

type JsonRecord = Record<string, unknown>

type AdminVariant = {
  id: string
  title?: string | null
  sku?: string | null
  manage_inventory?: boolean | null
  inventory_quantity?: number | null
  options?: Record<string, string> | Array<{ option?: { title?: string | null } | null; value?: string | null }> | null
  prices?: Array<{
    id?: string
    currency_code?: string | null
    amount?: number | null
  }> | null
  calculated_price?: {
    currency_code?: string | null
    calculated_amount?: number | null
    original_amount?: number | null
  } | null
}

type AdminProduct = {
  id: string
  title?: string | null
  handle?: string | null
  status?: string | null
  description?: string | null
  thumbnail?: string | null
  created_at?: string | null
  updated_at?: string | null
  variants?: AdminVariant[] | null
}

type CatalogArtist = {
  id: string
  name: string
  slug: string
  sortName: string | null
}

type CatalogReferenceValue = {
  id: string
  kind: ReferenceKind
  label: string
  value: string
  isActive: boolean
}

type CatalogProductProfile = {
  id: string
  productId: string
  releaseTitle: string | null
  labelId: string | null
  productTypeId: string | null
  releaseDate: string | null
  releaseYear: number | null
  descriptionHtml: string | null
  searchKeywords: string[]
  tracklist: unknown[]
  credits: JsonRecord
  pressingNotes: JsonRecord
  merchDetails: JsonRecord
  metadata: JsonRecord
}

type CatalogProductArtist = {
  id?: string
  artistId: string | null
  displayName: string
  role: string
  sortOrder: number
}

type CatalogProductReference = {
  id?: string
  referenceValueId: string
  kind: ReferenceKind
  sortOrder: number
}

type CatalogVariantProfile = {
  id?: string
  variantId: string
  productProfileId: string | null
  formatId: string | null
  formatDetailId: string | null
  formatLabel: string | null
  formatDetailLabel: string | null
  displayLabel: string | null
  availabilityStatus: AvailabilityStatus
  preorderReleaseDate: string | null
  backorderAllowed: boolean
  backorderNote: string | null
  imageUrl: string | null
}

type CatalogBundleProfile = {
  id: string
  productId: string
  productProfileId: string | null
  bundleType: BundleType
  inventoryMode: BundleInventoryMode
  fulfillmentMode: BundleFulfillmentMode
  displayTitle: string | null
  descriptionHtml: string | null
  isActive: boolean
}

type CatalogBundleComponent = {
  id?: string
  componentProductId: string
  componentVariantId: string | null
  componentInventoryItemId: string | null
  title: string | null
  variantTitle: string | null
  sku: string | null
  quantity: number
  sortOrder: number
  isRequired: boolean
}

type ProductProfileResponse = {
  profile: CatalogProductProfile | null
  artists: CatalogProductArtist[]
  references: CatalogProductReference[]
}

type VariantProfileResponse = {
  profile: CatalogVariantProfile | null
}

type BundleResponse = {
  bundle: CatalogBundleProfile | null
  components: CatalogBundleComponent[]
}

type ProductFormState = {
  title: string
  handle: string
  status: ProductStatus
  description: string
}

type ProfileFormState = {
  releaseTitle: string
  labelId: string
  labelLabel: string
  productTypeId: string
  productTypeLabel: string
  releaseDate: string
  releaseYear: string
  descriptionHtml: string
  searchKeywords: string
  tracklistJson: string
  creditsJson: string
  pressingNotesJson: string
  merchDetailsJson: string
  artists: ArtistFormLine[]
  references: ReferenceFormLine[]
}

type ArtistFormLine = {
  key: string
  artistId: string
  name: string
  displayName: string
  role: string
}

type ReferenceFormLine = {
  key: string
  kind: ReferenceKind
  referenceValueId: string
  label: string
}

type VariantProfileFormLine = {
  variantId: string
  displayLabel: string
  formatId: string
  formatLabel: string
  formatDetailId: string
  formatDetailLabel: string
  availabilityStatus: AvailabilityStatus
  preorderReleaseDate: string
  backorderAllowed: boolean
  backorderNote: string
  imageUrl: string
}

type BundleFormState = {
  enabled: boolean
  bundleType: BundleType
  inventoryMode: BundleInventoryMode
  fulfillmentMode: BundleFulfillmentMode
  displayTitle: string
  descriptionHtml: string
  isActive: boolean
  components: BundleComponentFormLine[]
}

type BundleComponentFormLine = {
  key: string
  componentProductId: string
  componentVariantId: string
  title: string
  variantTitle: string
  sku: string
  quantity: string
}

type CreateFormState = {
  kind: ProductKind
  title: string
  handle: string
  description: string
  artistName: string
  label: string
  genre: string
  productType: string
  format: string
  formatDetail: string
  variantTitle: string
  sku: string
  priceUsd: string
  availabilityStatus: AvailabilityStatus
  componentProductId: string
  componentVariantId: string
}

const emptyProductForm: ProductFormState = {
  title: "",
  handle: "",
  status: "draft",
  description: "",
}

const emptyProfileForm: ProfileFormState = {
  releaseTitle: "",
  labelId: "",
  labelLabel: "",
  productTypeId: "",
  productTypeLabel: "",
  releaseDate: "",
  releaseYear: "",
  descriptionHtml: "",
  searchKeywords: "",
  tracklistJson: "[]",
  creditsJson: "{}",
  pressingNotesJson: "{}",
  merchDetailsJson: "{}",
  artists: [],
  references: [],
}

const emptyBundleForm: BundleFormState = {
  enabled: false,
  bundleType: "fixed",
  inventoryMode: "component_derived",
  fulfillmentMode: "ship_components",
  displayTitle: "",
  descriptionHtml: "",
  isActive: true,
  components: [],
}

const emptyCreateForm: CreateFormState = {
  kind: "music_release",
  title: "",
  handle: "",
  description: "",
  artistName: "",
  label: "Remorseless Records",
  genre: "",
  productType: "Music release",
  format: "Vinyl",
  formatDetail: "",
  variantTitle: "Vinyl",
  sku: "",
  priceUsd: "0.00",
  availabilityStatus: "available",
  componentProductId: "",
  componentVariantId: "",
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

const toDateInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return date.toISOString().slice(0, 10)
}

const toDateTimeInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const toNullable = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const parseKeywords = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const parseJson = (value: string, fallback: unknown): unknown => {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error("Structured JSON fields must contain valid JSON.")
  }
}

const toPrettyJson = (value: unknown, fallback: unknown): string => {
  const source = value ?? fallback
  try {
    return JSON.stringify(source, null, 2)
  } catch {
    return JSON.stringify(fallback, null, 2)
  }
}

const extractErrorMessage = async (
  response: Response
): Promise<string | null> => {
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== "object") {
    return null
  }
  const message = (data as { message?: unknown }).message
  if (typeof message === "string") {
    return message
  }
  const error = (data as { error?: unknown }).error
  if (typeof error === "string") {
    return error
  }
  return null
}

const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await extractErrorMessage(response)
    throw new Error(message ?? `${path} returned ${response.status}`)
  }

  if (response.status === 204) {
    return {} as T
  }

  return (await response.json()) as T
}

const buildKey = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const normalizeStatus = (status: string | null | undefined): ProductStatus => {
  const match = productStatuses.find((value) => value === status)
  return match ?? "draft"
}

const normalizeAvailability = (
  status: string | null | undefined
): AvailabilityStatus => {
  const match = availabilityStatuses.find((value) => value === status)
  return match ?? "available"
}

const formatCurrency = (amount: number | null | undefined): string => {
  if (typeof amount !== "number") {
    return "Unpriced"
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount / 100)
}

const getVariantOptionLabel = (variant: AdminVariant): string => {
  const options = variant.options
  if (!options) {
    return ""
  }
  if (Array.isArray(options)) {
    return options
      .map((option) => option.value?.trim())
      .filter((value): value is string => Boolean(value))
      .join(" / ")
  }
  return Object.values(options)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(" / ")
}

const formatVariantLabel = (variant: AdminVariant): string => {
  const optionLabel = getVariantOptionLabel(variant)
  const title = variant.title?.trim() || optionLabel || "Variant"
  const sku = variant.sku?.trim()
  return sku ? `${title} (${sku})` : title
}

const defaultHandle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")

const toProductForm = (product: AdminProduct | null): ProductFormState => {
  if (!product) {
    return emptyProductForm
  }
  return {
    title: product.title ?? "",
    handle: product.handle ?? "",
    status: normalizeStatus(product.status),
    description: product.description ?? "",
  }
}

const toProfileForm = (
  response: ProductProfileResponse | null,
  referenceValues: CatalogReferenceValue[]
): ProfileFormState => {
  const profile = response?.profile ?? null
  const label = referenceValues.find((value) => value.id === profile?.labelId)
  const productType = referenceValues.find(
    (value) => value.id === profile?.productTypeId
  )

  return {
    releaseTitle: profile?.releaseTitle ?? "",
    labelId: profile?.labelId ?? "",
    labelLabel: label?.label ?? "",
    productTypeId: profile?.productTypeId ?? "",
    productTypeLabel: productType?.label ?? "",
    releaseDate: toDateInput(profile?.releaseDate),
    releaseYear: profile?.releaseYear?.toString() ?? "",
    descriptionHtml: profile?.descriptionHtml ?? "",
    searchKeywords: (profile?.searchKeywords ?? []).join(", "),
    tracklistJson: toPrettyJson(profile?.tracklist, []),
    creditsJson: toPrettyJson(profile?.credits, {}),
    pressingNotesJson: toPrettyJson(profile?.pressingNotes, {}),
    merchDetailsJson: toPrettyJson(profile?.merchDetails, {}),
    artists:
      response?.artists.map((artist) => ({
        key: artist.id ?? buildKey("artist"),
        artistId: artist.artistId ?? "",
        name: "",
        displayName: artist.displayName,
        role: artist.role,
      })) ?? [],
    references:
      response?.references.map((reference) => {
        const value = referenceValues.find(
          (item) => item.id === reference.referenceValueId
        )
        return {
          key: reference.id ?? buildKey("reference"),
          kind: reference.kind,
          referenceValueId: reference.referenceValueId,
          label: value?.label ?? "",
        }
      }) ?? [],
  }
}

const buildEmptyVariantProfile = (variantId: string): VariantProfileFormLine => ({
  variantId,
  displayLabel: "",
  formatId: "",
  formatLabel: "",
  formatDetailId: "",
  formatDetailLabel: "",
  availabilityStatus: "available",
  preorderReleaseDate: "",
  backorderAllowed: false,
  backorderNote: "",
  imageUrl: "",
})

const toVariantProfileLine = (
  variantId: string,
  profile: CatalogVariantProfile | null,
  references: CatalogReferenceValue[]
): VariantProfileFormLine => {
  if (!profile) {
    return buildEmptyVariantProfile(variantId)
  }
  const format = references.find((value) => value.id === profile.formatId)
  const formatDetail = references.find(
    (value) => value.id === profile.formatDetailId
  )
  return {
    variantId,
    displayLabel: profile.displayLabel ?? "",
    formatId: profile.formatId ?? "",
    formatLabel: profile.formatLabel ?? format?.label ?? "",
    formatDetailId: profile.formatDetailId ?? "",
    formatDetailLabel: profile.formatDetailLabel ?? formatDetail?.label ?? "",
    availabilityStatus: normalizeAvailability(profile.availabilityStatus),
    preorderReleaseDate: toDateTimeInput(profile.preorderReleaseDate),
    backorderAllowed: profile.backorderAllowed,
    backorderNote: profile.backorderNote ?? "",
    imageUrl: profile.imageUrl ?? "",
  }
}

const toBundleForm = (response: BundleResponse | null): BundleFormState => {
  if (!response?.bundle) {
    return emptyBundleForm
  }
  return {
    enabled: true,
    bundleType: response.bundle.bundleType,
    inventoryMode: response.bundle.inventoryMode,
    fulfillmentMode: response.bundle.fulfillmentMode,
    displayTitle: response.bundle.displayTitle ?? "",
    descriptionHtml: response.bundle.descriptionHtml ?? "",
    isActive: response.bundle.isActive,
    components: response.components.map((component) => ({
      key: component.id ?? buildKey("component"),
      componentProductId: component.componentProductId,
      componentVariantId: component.componentVariantId ?? "",
      title: component.title ?? "",
      variantTitle: component.variantTitle ?? "",
      sku: component.sku ?? "",
      quantity: component.quantity.toString(),
    })),
  }
}

const kindToProductType = (kind: ProductKind): string => {
  if (kind === "merch") {
    return "Merch"
  }
  if (kind === "fixed_bundle" || kind === "mystery_bundle") {
    return "Bundle"
  }
  return "Music release"
}

const isBundleKind = (kind: ProductKind): boolean =>
  kind === "fixed_bundle" || kind === "mystery_bundle"

const ProductAuthoringPage = memo(() => {
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [artists, setArtists] = useState<CatalogArtist[]>([])
  const [references, setReferences] = useState<CatalogReferenceValue[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm)
  const [profileForm, setProfileForm] = useState<ProfileFormState>(emptyProfileForm)
  const [variantProfiles, setVariantProfiles] = useState<VariantProfileFormLine[]>([])
  const [bundleForm, setBundleForm] = useState<BundleFormState>(emptyBundleForm)
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm)
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  )

  const activeReferences = useMemo(
    () => references.filter((reference) => reference.isActive),
    [references]
  )

  const referencesByKind = useMemo(() => {
    const grouped = new Map<ReferenceKind, CatalogReferenceValue[]>()
    for (const kind of referenceKinds) {
      grouped.set(kind, [])
    }
    for (const reference of activeReferences) {
      grouped.get(reference.kind)?.push(reference)
    }
    return grouped
  }, [activeReferences])

  const filteredProducts = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    if (!needle) {
      return products
    }
    return products.filter((product) => {
      const title = product.title?.toLowerCase() ?? ""
      const handle = product.handle?.toLowerCase() ?? ""
      return title.includes(needle) || handle.includes(needle) || product.id.includes(needle)
    })
  }, [products, searchQuery])

  const selectableProducts = useMemo(
    () => products.filter((product) => product.id !== selectedProductId),
    [products, selectedProductId]
  )

  const refreshProducts = useCallback(async () => {
    const response = await fetchJson<{ products: AdminProduct[] }>(
      "/admin/products?limit=200&fields=*variants,*variants.prices"
    )
    setProducts(response.products ?? [])
  }, [])

  const refreshReferences = useCallback(async () => {
    const [artistResponse, referenceResponse] = await Promise.all([
      fetchJson<{ artists: CatalogArtist[] }>("/admin/catalog/artists?limit=500"),
      fetchJson<{ values: CatalogReferenceValue[] }>(
        "/admin/catalog/reference-values?limit=500&active=true"
      ),
    ])
    setArtists(artistResponse.artists ?? [])
    setReferences(referenceResponse.values ?? [])
  }, [])

  const loadProductAuthoring = useCallback(
    async (product: AdminProduct | null) => {
      if (!product) {
        setProductForm(emptyProductForm)
        setProfileForm(emptyProfileForm)
        setVariantProfiles([])
        setBundleForm(emptyBundleForm)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const [profileResponse, bundleResponse] = await Promise.all([
          fetchJson<ProductProfileResponse>(
            `/admin/catalog/products/${product.id}/profile`
          ),
          fetchJson<BundleResponse>(`/admin/catalog/products/${product.id}/bundle`),
        ])
        const variantResponses = await Promise.all(
          (product.variants ?? []).map(async (variant) => ({
            variantId: variant.id,
            response: await fetchJson<VariantProfileResponse>(
              `/admin/catalog/variants/${variant.id}/profile`
            ),
          }))
        )

        setProductForm(toProductForm(product))
        setProfileForm(toProfileForm(profileResponse, references))
        setBundleForm(toBundleForm(bundleResponse))
        setVariantProfiles(
          variantResponses.map(({ variantId, response }) =>
            toVariantProfileLine(variantId, response.profile, references)
          )
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load product")
      } finally {
        setLoading(false)
      }
    },
    [references]
  )

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([refreshProducts(), refreshReferences()])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load catalog data")
    } finally {
      setLoading(false)
    }
  }, [refreshProducts, refreshReferences])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const firstProduct = products.at(0)
    if (!selectedProductId && firstProduct) {
      setSelectedProductId(firstProduct.id)
    }
  }, [products, selectedProductId])

  useEffect(() => {
    void loadProductAuthoring(selectedProduct)
  }, [loadProductAuthoring, selectedProduct])

  const updateProductField = useCallback(
    (field: keyof ProductFormState) => (value: string) => {
      setProductForm((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const updateProfileField = useCallback(
    (field: keyof Omit<ProfileFormState, "artists" | "references">) =>
      (value: string) => {
        setProfileForm((prev) => ({ ...prev, [field]: value }))
      },
    []
  )

  const addArtistLine = useCallback(() => {
    setProfileForm((prev) => ({
      ...prev,
      artists: [
        ...prev.artists,
        {
          key: buildKey("artist"),
          artistId: "",
          name: "",
          displayName: "",
          role: "primary",
        },
      ],
    }))
  }, [])

  const updateArtistLine = useCallback(
    (key: string, patch: Partial<ArtistFormLine>) => {
      setProfileForm((prev) => ({
        ...prev,
        artists: prev.artists.map((line) =>
          line.key === key ? { ...line, ...patch } : line
        ),
      }))
    },
    []
  )

  const removeArtistLine = useCallback((key: string) => {
    setProfileForm((prev) => ({
      ...prev,
      artists: prev.artists.filter((line) => line.key !== key),
    }))
  }, [])

  const addReferenceLine = useCallback((kind: ReferenceKind = "genre") => {
    setProfileForm((prev) => ({
      ...prev,
      references: [
        ...prev.references,
        {
          key: buildKey("reference"),
          kind,
          referenceValueId: "",
          label: "",
        },
      ],
    }))
  }, [])

  const updateReferenceLine = useCallback(
    (key: string, patch: Partial<ReferenceFormLine>) => {
      setProfileForm((prev) => ({
        ...prev,
        references: prev.references.map((line) =>
          line.key === key ? { ...line, ...patch } : line
        ),
      }))
    },
    []
  )

  const removeReferenceLine = useCallback((key: string) => {
    setProfileForm((prev) => ({
      ...prev,
      references: prev.references.filter((line) => line.key !== key),
    }))
  }, [])

  const updateVariantLine = useCallback(
    (variantId: string, patch: Partial<VariantProfileFormLine>) => {
      setVariantProfiles((prev) =>
        prev.map((line) =>
          line.variantId === variantId ? { ...line, ...patch } : line
        )
      )
    },
    []
  )

  const updateBundleField = useCallback(
    (field: keyof Omit<BundleFormState, "components">, value: string | boolean) => {
      setBundleForm((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const addBundleComponent = useCallback(() => {
    setBundleForm((prev) => ({
      ...prev,
      components: [
        ...prev.components,
        {
          key: buildKey("component"),
          componentProductId: "",
          componentVariantId: "",
          title: "",
          variantTitle: "",
          sku: "",
          quantity: "1",
        },
      ],
    }))
  }, [])

  const updateBundleComponent = useCallback(
    (key: string, patch: Partial<BundleComponentFormLine>) => {
      setBundleForm((prev) => ({
        ...prev,
        components: prev.components.map((line) =>
          line.key === key ? { ...line, ...patch } : line
        ),
      }))
    },
    []
  )

  const removeBundleComponent = useCallback((key: string) => {
    setBundleForm((prev) => ({
      ...prev,
      components: prev.components.filter((line) => line.key !== key),
    }))
  }, [])

  const selectComponentProduct = useCallback(
    (key: string, productId: string) => {
      const product = products.find((item) => item.id === productId)
      const firstVariant = product?.variants?.[0]
      updateBundleComponent(key, {
        componentProductId: productId,
        componentVariantId: firstVariant?.id ?? "",
        title: product?.title ?? "",
        variantTitle: firstVariant ? formatVariantLabel(firstVariant) : "",
        sku: firstVariant?.sku ?? "",
      })
    },
    [products, updateBundleComponent]
  )

  const saveProduct = useCallback(async () => {
    if (!selectedProduct) {
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const releaseYear = profileForm.releaseYear.trim()
        ? Number.parseInt(profileForm.releaseYear, 10)
        : null
      if (releaseYear !== null && Number.isNaN(releaseYear)) {
        throw new Error("Release year must be a number.")
      }

      const productPayload = {
        title: productForm.title.trim(),
        handle: productForm.handle.trim(),
        status: productForm.status,
        description: toNullable(productForm.description),
      }
      await fetchJson<{ product: AdminProduct }>(
        `/admin/products/${selectedProduct.id}`,
        {
          method: "POST",
          body: JSON.stringify(productPayload),
        }
      )

      const artistLines = profileForm.artists.filter(
        (artist) =>
          artist.artistId.trim() ||
          artist.name.trim() ||
          artist.displayName.trim()
      )
      const referenceLines = profileForm.references.filter(
        (reference) => reference.referenceValueId.trim() || reference.label.trim()
      )
      const bundleComponentLines = bundleForm.components.filter(
        (component) => component.componentProductId.trim()
      )

      const profilePayload = {
        releaseTitle: toNullable(profileForm.releaseTitle),
        labelId: toNullable(profileForm.labelId),
        label: profileForm.labelId
          ? undefined
          : {
              label: toNullable(profileForm.labelLabel),
            },
        productTypeId: toNullable(profileForm.productTypeId),
        productType: profileForm.productTypeId
          ? undefined
          : {
              label: toNullable(profileForm.productTypeLabel),
            },
        releaseDate: toNullable(profileForm.releaseDate),
        releaseYear,
        descriptionHtml: toNullable(profileForm.descriptionHtml),
        searchKeywords: parseKeywords(profileForm.searchKeywords),
        tracklist: parseJson(profileForm.tracklistJson, []),
        credits: parseJson(profileForm.creditsJson, {}),
        pressingNotes: parseJson(profileForm.pressingNotesJson, {}),
        merchDetails: parseJson(profileForm.merchDetailsJson, {}),
        artists: artistLines.map((artist, index) => ({
          artistId: toNullable(artist.artistId),
          name: artist.artistId ? undefined : toNullable(artist.name),
          displayName: toNullable(artist.displayName) ?? toNullable(artist.name),
          role: artist.role.trim() || "primary",
          sortOrder: index,
        })),
        references: referenceLines.map((reference, index) => ({
          referenceValueId: toNullable(reference.referenceValueId),
          kind: reference.referenceValueId ? undefined : reference.kind,
          label: reference.referenceValueId ? undefined : toNullable(reference.label),
          sortOrder: index,
        })),
      }
      const profileResponse = await fetchJson<ProductProfileResponse>(
        `/admin/catalog/products/${selectedProduct.id}/profile`,
        {
          method: "PUT",
          body: JSON.stringify(profilePayload),
        }
      )

      for (const variantProfile of variantProfiles) {
        await fetchJson<VariantProfileResponse>(
          `/admin/catalog/variants/${variantProfile.variantId}/profile`,
          {
            method: "PUT",
            body: JSON.stringify({
              productProfileId: profileResponse.profile?.id ?? undefined,
              formatId: toNullable(variantProfile.formatId),
              format: variantProfile.formatId
                ? undefined
                : {
                    label: toNullable(variantProfile.formatLabel),
                  },
              formatDetailId: toNullable(variantProfile.formatDetailId),
              formatDetail: variantProfile.formatDetailId
                ? undefined
                : {
                    label: toNullable(variantProfile.formatDetailLabel),
                  },
              displayLabel: toNullable(variantProfile.displayLabel),
              availabilityStatus: variantProfile.availabilityStatus,
              preorderReleaseDate: toNullable(variantProfile.preorderReleaseDate),
              backorderAllowed: variantProfile.backorderAllowed,
              backorderNote: toNullable(variantProfile.backorderNote),
              imageUrl: toNullable(variantProfile.imageUrl),
            }),
          }
        )
      }

      if (bundleForm.enabled) {
        await fetchJson<BundleResponse>(
          `/admin/catalog/products/${selectedProduct.id}/bundle`,
          {
            method: "PUT",
            body: JSON.stringify({
              productProfileId: profileResponse.profile?.id ?? undefined,
              bundleType: bundleForm.bundleType,
              inventoryMode: bundleForm.inventoryMode,
              fulfillmentMode: bundleForm.fulfillmentMode,
              displayTitle: toNullable(bundleForm.displayTitle),
              descriptionHtml: toNullable(bundleForm.descriptionHtml),
              isActive: bundleForm.isActive,
              components: bundleComponentLines.map((component, index) => ({
                componentProductId: component.componentProductId,
                componentVariantId: toNullable(component.componentVariantId),
                title: toNullable(component.title),
                variantTitle: toNullable(component.variantTitle),
                sku: toNullable(component.sku),
                quantity: Number.parseInt(component.quantity, 10) || 1,
                sortOrder: index,
              })),
            }),
          }
        )
      } else {
        await fetchJson(`/admin/catalog/products/${selectedProduct.id}/bundle`, {
          method: "DELETE",
        })
      }

      await refreshProducts()
      await refreshReferences()
      await loadProductAuthoring(selectedProduct)
      setNotice("Saved catalog authoring changes.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save product")
    } finally {
      setSaving(false)
    }
  }, [
    bundleForm,
    loadProductAuthoring,
    productForm,
    profileForm,
    refreshProducts,
    refreshReferences,
    selectedProduct,
    variantProfiles,
  ])

  const updateCreateField = useCallback(
    (field: keyof CreateFormState) => (value: string) => {
      setCreateForm((prev) => {
        const next = { ...prev, [field]: value }
        if (field === "title" && !prev.handle.trim()) {
          next.handle = defaultHandle(value)
        }
        if (field === "kind") {
          const kind = value as ProductKind
          next.productType = kindToProductType(kind)
          if (kind === "merch") {
            next.format = "Merch"
            next.variantTitle = "Merch"
          }
          if (kind === "fixed_bundle") {
            next.productType = "Bundle"
            next.variantTitle = next.variantTitle || "Bundle"
          }
          if (kind === "mystery_bundle") {
            next.productType = "Bundle"
            next.variantTitle = next.variantTitle || "Mystery bundle"
          }
        }
        if (field === "format" && !prev.variantTitle.trim()) {
          next.variantTitle = value
        }
        return next
      })
    },
    []
  )

  const createProduct = useCallback(async () => {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const title = createForm.title.trim()
      if (!title) {
        throw new Error("Title is required.")
      }
      const handle = createForm.handle.trim() || defaultHandle(title)
      const variantTitle =
        createForm.variantTitle.trim() ||
        createForm.formatDetail.trim() ||
        createForm.format.trim() ||
        "Default"
      const amount = Math.round(Number.parseFloat(createForm.priceUsd || "0") * 100)
      if (Number.isNaN(amount) || amount < 0) {
        throw new Error("Price must be a valid amount.")
      }
      if (createForm.kind === "fixed_bundle" && !createForm.componentProductId) {
        throw new Error("A fixed bundle needs at least one included product.")
      }

      const productResponse = await fetchJson<{ product: AdminProduct }>(
        "/admin/products",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            handle,
            status: "draft",
            description: toNullable(createForm.description),
            metadata: {
              authoring_kind: createForm.kind,
            },
            options: [
              {
                title: "Format",
                values: [variantTitle],
              },
            ],
            variants: [
              {
                title: variantTitle,
                sku: toNullable(createForm.sku) ?? handle,
                manage_inventory: false,
                options: {
                  Format: variantTitle,
                },
                prices: [
                  {
                    currency_code: "usd",
                    amount,
                  },
                ],
              },
            ],
          }),
        }
      )

      const created = productResponse.product
      const variant = created.variants?.[0]
      const referencesPayload = [
        createForm.genre.trim()
          ? {
              kind: "genre" as ReferenceKind,
              label: createForm.genre.trim(),
              sortOrder: 0,
            }
          : null,
      ].filter((value): value is { kind: ReferenceKind; label: string; sortOrder: number } =>
        Boolean(value)
      )

      const profileResponse = await fetchJson<ProductProfileResponse>(
        `/admin/catalog/products/${created.id}/profile`,
        {
          method: "PUT",
          body: JSON.stringify({
            releaseTitle: title,
            label: {
              label: toNullable(createForm.label),
            },
            productType: {
              label: toNullable(createForm.productType),
            },
            descriptionHtml: toNullable(createForm.description),
            artists: createForm.artistName.trim()
              ? [
                  {
                    name: createForm.artistName.trim(),
                    displayName: createForm.artistName.trim(),
                    role: "primary",
                    sortOrder: 0,
                  },
                ]
              : [],
            references: referencesPayload,
          }),
        }
      )

      if (variant) {
        await fetchJson<VariantProfileResponse>(
          `/admin/catalog/variants/${variant.id}/profile`,
          {
            method: "PUT",
            body: JSON.stringify({
              productProfileId: profileResponse.profile?.id ?? undefined,
              format: {
                label: toNullable(createForm.format),
              },
              formatDetail: {
                label: toNullable(createForm.formatDetail),
              },
              displayLabel: variantTitle,
              availabilityStatus: createForm.availabilityStatus,
            }),
          }
        )
      }

      if (isBundleKind(createForm.kind)) {
        const componentProduct = products.find(
          (product) => product.id === createForm.componentProductId
        )
        const componentVariant =
          componentProduct?.variants?.find(
            (item) => item.id === createForm.componentVariantId
          ) ?? componentProduct?.variants?.[0]
        await fetchJson<BundleResponse>(
          `/admin/catalog/products/${created.id}/bundle`,
          {
            method: "PUT",
            body: JSON.stringify({
              productProfileId: profileResponse.profile?.id ?? undefined,
              bundleType: createForm.kind === "mystery_bundle" ? "mystery" : "fixed",
              inventoryMode:
                createForm.kind === "mystery_bundle" ? "manual" : "component_derived",
              fulfillmentMode:
                createForm.kind === "mystery_bundle" ? "manual" : "ship_components",
              displayTitle: title,
              descriptionHtml: toNullable(createForm.description),
              isActive: true,
              components:
                createForm.kind === "mystery_bundle"
                  ? []
                  : [
                      {
                        componentProductId: createForm.componentProductId,
                        componentVariantId: componentVariant?.id ?? undefined,
                        title: componentProduct?.title ?? undefined,
                        variantTitle: componentVariant
                          ? formatVariantLabel(componentVariant)
                          : undefined,
                        sku: componentVariant?.sku ?? undefined,
                        quantity: 1,
                        sortOrder: 0,
                      },
                    ],
            }),
          }
        )
      }

      await refreshProducts()
      await refreshReferences()
      setSelectedProductId(created.id)
      setCreateForm(emptyCreateForm)
      setCreateOpen(false)
      setNotice("Created draft product.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create product")
    } finally {
      setCreating(false)
    }
  }, [createForm, products, refreshProducts, refreshReferences])

  const defaultEditorHref = selectedProduct
    ? `/app/products/${selectedProduct.id}`
    : "/app/products"

  return (
    <div className="flex flex-col gap-y-6">
      <Container className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Heading level="h1">Product authoring</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Structured catalog editing with Medusa product fallback.
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void refreshAll()}>
              Refresh
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Create draft
            </Button>
          </div>
        </div>
        {error ? (
          <div className="rounded-md border border-ui-border-error bg-ui-bg-error px-3 py-2">
            <Text size="small" className="text-ui-fg-error">
              {error}
            </Text>
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="small" className="text-ui-fg-base">
              {notice}
            </Text>
          </div>
        ) : null}
      </Container>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px),1fr]">
        <Container className="p-0">
          <div className="border-b border-ui-border-base p-4">
            <div className="flex items-center justify-between gap-3">
              <Heading level="h2">Products</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {filteredProducts.length} shown
              </Text>
            </div>
            <Input
              className="mt-3"
              value={searchQuery}
              placeholder="Search title, handle, or ID"
              onChange={(event) => setSearchQuery(readValue(event))}
            />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <Table>
              <Table.Body>
                {filteredProducts.map((product) => {
                  const selected = product.id === selectedProductId
                  return (
                    <Table.Row key={product.id}>
                      <Table.Cell>
                        <button
                          type="button"
                          className={`flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left ${
                            selected ? "bg-ui-bg-subtle" : "hover:bg-ui-bg-subtle"
                          }`}
                          onClick={() => setSelectedProductId(product.id)}
                        >
                          <span className="text-sm font-medium text-ui-fg-base">
                            {product.title ?? "Untitled product"}
                          </span>
                          <span className="text-xs text-ui-fg-subtle">
                            {product.handle ?? product.id}
                          </span>
                          <span className="text-xs uppercase text-ui-fg-muted">
                            {product.status ?? "draft"}
                          </span>
                        </button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>
        </Container>

        <Container className="p-0">
          {selectedProduct ? (
            <div className="flex flex-col">
              <div className="flex flex-col gap-3 border-b border-ui-border-base p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <Heading level="h2">{selectedProduct.title ?? "Untitled product"}</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    {selectedProduct.handle ?? selectedProduct.id}
                  </Text>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={defaultEditorHref}
                    className="inline-flex min-h-8 items-center rounded-md border border-ui-border-base px-3 text-sm text-ui-fg-base hover:bg-ui-bg-subtle"
                  >
                    Default Medusa editor
                  </a>
                  <Button type="button" disabled={saving || loading} onClick={saveProduct}>
                    {saving ? "Saving..." : "Save authoring"}
                  </Button>
                </div>
              </div>

              <div className="space-y-8 p-5">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <PencilSquare className="h-4 w-4 text-ui-fg-subtle" />
                    <Heading level="h3">Medusa product</Heading>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={productForm.title}
                        onChange={(event) => updateProductField("title")(readValue(event))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Handle</Label>
                      <Input
                        value={productForm.handle}
                        onChange={(event) => updateProductField("handle")(readValue(event))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <select
                        value={productForm.status}
                        onChange={(event) =>
                          updateProductField("status")(readValue(event))
                        }
                        className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                      >
                        {productStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Medusa description</Label>
                      <Textarea
                        value={productForm.description}
                        rows={3}
                        onChange={(event) =>
                          updateProductField("description")(readValue(event))
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <Heading level="h3">Catalog profile</Heading>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Release title</Label>
                      <Input
                        value={profileForm.releaseTitle}
                        onChange={(event) =>
                          updateProfileField("releaseTitle")(readValue(event))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Label/source</Label>
                      <select
                        value={profileForm.labelId}
                        onChange={(event) =>
                          setProfileForm((prev) => ({
                            ...prev,
                            labelId: readValue(event),
                            labelLabel:
                              references.find((value) => value.id === readValue(event))
                                ?.label ?? prev.labelLabel,
                          }))
                        }
                        className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                      >
                        <option value="">New label/source</option>
                        {(referencesByKind.get("label") ?? []).map((reference) => (
                          <option key={reference.id} value={reference.id}>
                            {reference.label}
                          </option>
                        ))}
                      </select>
                      {!profileForm.labelId ? (
                        <Input
                          value={profileForm.labelLabel}
                          placeholder="Remorseless Records"
                          onChange={(event) =>
                            updateProfileField("labelLabel")(readValue(event))
                          }
                        />
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label>Product type</Label>
                      <select
                        value={profileForm.productTypeId}
                        onChange={(event) =>
                          setProfileForm((prev) => ({
                            ...prev,
                            productTypeId: readValue(event),
                            productTypeLabel:
                              references.find((value) => value.id === readValue(event))
                                ?.label ?? prev.productTypeLabel,
                          }))
                        }
                        className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                      >
                        <option value="">New product type</option>
                        {(referencesByKind.get("product_type") ?? []).map((reference) => (
                          <option key={reference.id} value={reference.id}>
                            {reference.label}
                          </option>
                        ))}
                      </select>
                      {!profileForm.productTypeId ? (
                        <Input
                          value={profileForm.productTypeLabel}
                          placeholder="Music release"
                          onChange={(event) =>
                            updateProfileField("productTypeLabel")(readValue(event))
                          }
                        />
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Release date</Label>
                        <Input
                          type="date"
                          value={profileForm.releaseDate}
                          onChange={(event) =>
                            updateProfileField("releaseDate")(readValue(event))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Release year</Label>
                        <Input
                          value={profileForm.releaseYear}
                          onChange={(event) =>
                            updateProfileField("releaseYear")(readValue(event))
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Rich product description</Label>
                      <RichTextEditor
                        value={profileForm.descriptionHtml}
                        onChange={updateProfileField("descriptionHtml")}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Search keywords</Label>
                      <Input
                        value={profileForm.searchKeywords}
                        onChange={(event) =>
                          updateProfileField("searchKeywords")(readValue(event))
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <Heading level="h3">Artists</Heading>
                    <Button type="button" size="small" variant="secondary" onClick={addArtistLine}>
                      Add artist
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {profileForm.artists.map((line) => (
                      <div key={line.key} className="grid gap-3 rounded-md border border-ui-border-base p-3 lg:grid-cols-[1fr,1fr,140px,auto]">
                        <div className="space-y-2">
                          <Label>Existing artist</Label>
                          <select
                            value={line.artistId}
                            onChange={(event) => {
                              const artistId = readValue(event)
                              const artist = artists.find((item) => item.id === artistId)
                              updateArtistLine(line.key, {
                                artistId,
                                displayName: artist?.name ?? line.displayName,
                              })
                            }}
                            className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                          >
                            <option value="">New artist</option>
                            {artists.map((artist) => (
                              <option key={artist.id} value={artist.id}>
                                {artist.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label>Name/display</Label>
                          <Input
                            value={line.displayName || line.name}
                            onChange={(event) =>
                              updateArtistLine(line.key, {
                                name: readValue(event),
                                displayName: readValue(event),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Role</Label>
                          <Input
                            value={line.role}
                            onChange={(event) =>
                              updateArtistLine(line.key, { role: readValue(event) })
                            }
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => removeArtistLine(line.key)}
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Heading level="h3">Genres, tags, and controlled values</Heading>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="small" variant="secondary" onClick={() => addReferenceLine("genre")}>
                        Add genre
                      </Button>
                      <Button type="button" size="small" variant="secondary" onClick={() => addReferenceLine("utility_tag")}>
                        Add tag
                      </Button>
                      <Button type="button" size="small" variant="secondary" onClick={() => addReferenceLine("merch_type")}>
                        Add merch type
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {profileForm.references.map((line) => {
                      const options = referencesByKind.get(line.kind) ?? []
                      return (
                        <div key={line.key} className="grid gap-3 rounded-md border border-ui-border-base p-3 lg:grid-cols-[160px,1fr,1fr,auto]">
                          <div className="space-y-2">
                            <Label>Kind</Label>
                            <select
                              value={line.kind}
                              onChange={(event) =>
                                updateReferenceLine(line.key, {
                                  kind: readValue(event) as ReferenceKind,
                                  referenceValueId: "",
                                  label: "",
                                })
                              }
                              className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                            >
                              {referenceKinds.map((kind) => (
                                <option key={kind} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>Existing value</Label>
                            <select
                              value={line.referenceValueId}
                              onChange={(event) => {
                                const referenceValueId = readValue(event)
                                const reference = references.find(
                                  (item) => item.id === referenceValueId
                                )
                                updateReferenceLine(line.key, {
                                  referenceValueId,
                                  label: reference?.label ?? line.label,
                                })
                              }}
                              className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                            >
                              <option value="">New value</option>
                              {options.map((reference) => (
                                <option key={reference.id} value={reference.id}>
                                  {reference.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>New label</Label>
                            <Input
                              value={line.label}
                              disabled={Boolean(line.referenceValueId)}
                              onChange={(event) =>
                                updateReferenceLine(line.key, {
                                  label: readValue(event),
                                })
                              }
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              size="small"
                              variant="secondary"
                              onClick={() => removeReferenceLine(line.key)}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="space-y-4">
                  <Heading level="h3">Structured release fields</Heading>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tracklist JSON</Label>
                      <Textarea
                        rows={8}
                        value={profileForm.tracklistJson}
                        onChange={(event) =>
                          updateProfileField("tracklistJson")(readValue(event))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Credits JSON</Label>
                      <Textarea
                        rows={8}
                        value={profileForm.creditsJson}
                        onChange={(event) =>
                          updateProfileField("creditsJson")(readValue(event))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pressing notes JSON</Label>
                      <Textarea
                        rows={8}
                        value={profileForm.pressingNotesJson}
                        onChange={(event) =>
                          updateProfileField("pressingNotesJson")(readValue(event))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Merch details JSON</Label>
                      <Textarea
                        rows={8}
                        value={profileForm.merchDetailsJson}
                        onChange={(event) =>
                          updateProfileField("merchDetailsJson")(readValue(event))
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <Heading level="h3">Variants</Heading>
                  <div className="space-y-4">
                    {(selectedProduct.variants ?? []).map((variant) => {
                      const line =
                        variantProfiles.find((item) => item.variantId === variant.id) ??
                        buildEmptyVariantProfile(variant.id)
                      const price =
                        variant.calculated_price?.calculated_amount ??
                        variant.prices?.[0]?.amount
                      return (
                        <div key={variant.id} className="space-y-4 rounded-md border border-ui-border-base p-4">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <Text size="small" className="font-medium">
                                {formatVariantLabel(variant)}
                              </Text>
                              <Text size="xsmall" className="text-ui-fg-subtle">
                                {formatCurrency(price)} · {variant.manage_inventory ? "Managed stock" : "Manual stock"}
                              </Text>
                            </div>
                            <Text size="xsmall" className="text-ui-fg-muted">
                              {variant.id}
                            </Text>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Display label</Label>
                              <Input
                                value={line.displayLabel}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    displayLabel: readValue(event),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Availability</Label>
                              <select
                                value={line.availabilityStatus}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    availabilityStatus: readValue(event) as AvailabilityStatus,
                                  })
                                }
                                className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                              >
                                {availabilityStatuses.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label>Format</Label>
                              <select
                                value={line.formatId}
                                onChange={(event) => {
                                  const formatId = readValue(event)
                                  const reference = references.find(
                                    (item) => item.id === formatId
                                  )
                                  updateVariantLine(variant.id, {
                                    formatId,
                                    formatLabel: reference?.label ?? line.formatLabel,
                                  })
                                }}
                                className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                              >
                                <option value="">New format</option>
                                {(referencesByKind.get("format") ?? []).map((reference) => (
                                  <option key={reference.id} value={reference.id}>
                                    {reference.label}
                                  </option>
                                ))}
                              </select>
                              {!line.formatId ? (
                                <Input
                                  value={line.formatLabel}
                                  onChange={(event) =>
                                    updateVariantLine(variant.id, {
                                      formatLabel: readValue(event),
                                    })
                                  }
                                />
                              ) : null}
                            </div>
                            <div className="space-y-2">
                              <Label>Format detail</Label>
                              <select
                                value={line.formatDetailId}
                                onChange={(event) => {
                                  const formatDetailId = readValue(event)
                                  const reference = references.find(
                                    (item) => item.id === formatDetailId
                                  )
                                  updateVariantLine(variant.id, {
                                    formatDetailId,
                                    formatDetailLabel:
                                      reference?.label ?? line.formatDetailLabel,
                                  })
                                }}
                                className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                              >
                                <option value="">New detail</option>
                                {(referencesByKind.get("format_detail") ?? []).map(
                                  (reference) => (
                                    <option key={reference.id} value={reference.id}>
                                      {reference.label}
                                    </option>
                                  )
                                )}
                              </select>
                              {!line.formatDetailId ? (
                                <Input
                                  value={line.formatDetailLabel}
                                  onChange={(event) =>
                                    updateVariantLine(variant.id, {
                                      formatDetailLabel: readValue(event),
                                    })
                                  }
                                />
                              ) : null}
                            </div>
                            <div className="space-y-2">
                              <Label>Preorder release date</Label>
                              <Input
                                type="datetime-local"
                                value={line.preorderReleaseDate}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    preorderReleaseDate: readValue(event),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Image URL override</Label>
                              <Input
                                value={line.imageUrl}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    imageUrl: readValue(event),
                                  })
                                }
                              />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-ui-fg-base">
                              <input
                                type="checkbox"
                                checked={line.backorderAllowed}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    backorderAllowed: readChecked(event),
                                  })
                                }
                              />
                              Backorder allowed
                            </label>
                            <div className="space-y-2">
                              <Label>Backorder note</Label>
                              <Input
                                value={line.backorderNote}
                                onChange={(event) =>
                                  updateVariantLine(variant.id, {
                                    backorderNote: readValue(event),
                                  })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Heading level="h3">Bundle</Heading>
                    <label className="flex items-center gap-2 text-sm text-ui-fg-base">
                      <input
                        type="checkbox"
                        checked={bundleForm.enabled}
                        onChange={(event) =>
                          updateBundleField("enabled", readChecked(event))
                        }
                      />
                      Enable bundle
                    </label>
                  </div>
                  {bundleForm.enabled ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="space-y-2">
                          <Label>Bundle type</Label>
                          <select
                            value={bundleForm.bundleType}
                            onChange={(event) =>
                              updateBundleField("bundleType", readValue(event) as BundleType)
                            }
                            className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                          >
                            {bundleTypes.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label>Inventory mode</Label>
                          <select
                            value={bundleForm.inventoryMode}
                            onChange={(event) =>
                              updateBundleField(
                                "inventoryMode",
                                readValue(event) as BundleInventoryMode
                              )
                            }
                            className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                          >
                            {bundleInventoryModes.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label>Fulfillment mode</Label>
                          <select
                            value={bundleForm.fulfillmentMode}
                            onChange={(event) =>
                              updateBundleField(
                                "fulfillmentMode",
                                readValue(event) as BundleFulfillmentMode
                              )
                            }
                            className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                          >
                            {bundleFulfillmentModes.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-end gap-2 pb-2 text-sm text-ui-fg-base">
                          <input
                            type="checkbox"
                            checked={bundleForm.isActive}
                            onChange={(event) =>
                              updateBundleField("isActive", readChecked(event))
                            }
                          />
                          Active
                        </label>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Display title</Label>
                          <Input
                            value={bundleForm.displayTitle}
                            onChange={(event) =>
                              updateBundleField("displayTitle", readValue(event))
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Description HTML</Label>
                          <Textarea
                            rows={4}
                            value={bundleForm.descriptionHtml}
                            onChange={(event) =>
                              updateBundleField("descriptionHtml", readValue(event))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <Text size="small" className="font-medium">
                          Included products
                        </Text>
                        <Button type="button" size="small" variant="secondary" onClick={addBundleComponent}>
                          Add included product
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {bundleForm.components.map((component) => {
                          const componentProduct = products.find(
                            (product) => product.id === component.componentProductId
                          )
                          return (
                            <div key={component.key} className="grid gap-3 rounded-md border border-ui-border-base p-3 lg:grid-cols-[1fr,1fr,90px,auto]">
                              <div className="space-y-2">
                                <Label>Product</Label>
                                <select
                                  value={component.componentProductId}
                                  onChange={(event) =>
                                    selectComponentProduct(component.key, readValue(event))
                                  }
                                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                                >
                                  <option value="">Select product</option>
                                  {selectableProducts.map((product) => (
                                    <option key={product.id} value={product.id}>
                                      {product.title ?? product.handle ?? product.id}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label>Variant</Label>
                                <select
                                  value={component.componentVariantId}
                                  onChange={(event) => {
                                    const componentVariantId = readValue(event)
                                    const variant = componentProduct?.variants?.find(
                                      (item) => item.id === componentVariantId
                                    )
                                    updateBundleComponent(component.key, {
                                      componentVariantId,
                                      variantTitle: variant ? formatVariantLabel(variant) : "",
                                      sku: variant?.sku ?? "",
                                    })
                                  }}
                                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                                >
                                  <option value="">Product only</option>
                                  {(componentProduct?.variants ?? []).map((variant) => (
                                    <option key={variant.id} value={variant.id}>
                                      {formatVariantLabel(variant)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label>Qty</Label>
                                <Input
                                  value={component.quantity}
                                  onChange={(event) =>
                                    updateBundleComponent(component.key, {
                                      quantity: readValue(event),
                                    })
                                  }
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  size="small"
                                  variant="secondary"
                                  onClick={() => removeBundleComponent(component.key)}
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          ) : (
            <div className="p-8">
              <Heading level="h2">No product selected</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create or select a draft product to edit catalog fields.
              </Text>
            </div>
          )}
        </Container>
      </div>

      <FocusModal open={createOpen} onOpenChange={setCreateOpen}>
        <FocusModal.Content className="max-w-5xl sm:inset-y-8 sm:inset-x-1/2 sm:-translate-x-1/2 sm:w-full">
          <FocusModal.Header>
            <FocusModal.Title>Create draft product</FocusModal.Title>
          </FocusModal.Header>
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Kind</Label>
                <select
                  value={createForm.kind}
                  onChange={(event) =>
                    updateCreateField("kind")(readValue(event) as ProductKind)
                  }
                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                >
                  {productKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Product type</Label>
                <Input
                  value={createForm.productType}
                  onChange={(event) => updateCreateField("productType")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={createForm.title}
                  onChange={(event) => updateCreateField("title")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Handle</Label>
                <Input
                  value={createForm.handle}
                  onChange={(event) => updateCreateField("handle")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Artist</Label>
                <Input
                  value={createForm.artistName}
                  onChange={(event) => updateCreateField("artistName")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Label/source</Label>
                <Input
                  value={createForm.label}
                  onChange={(event) => updateCreateField("label")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Genre</Label>
                <Input
                  value={createForm.genre}
                  onChange={(event) => updateCreateField("genre")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Availability</Label>
                <select
                  value={createForm.availabilityStatus}
                  onChange={(event) =>
                    updateCreateField("availabilityStatus")(
                      readValue(event) as AvailabilityStatus
                    )
                  }
                  className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                >
                  {availabilityStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Format</Label>
                <Input
                  value={createForm.format}
                  onChange={(event) => updateCreateField("format")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>Format detail</Label>
                <Input
                  value={createForm.formatDetail}
                  onChange={(event) =>
                    updateCreateField("formatDetail")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Variant title</Label>
                <Input
                  value={createForm.variantTitle}
                  onChange={(event) =>
                    updateCreateField("variantTitle")(readValue(event))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={createForm.sku}
                  onChange={(event) => updateCreateField("sku")(readValue(event))}
                />
              </div>
              <div className="space-y-2">
                <Label>USD price</Label>
                <Input
                  value={createForm.priceUsd}
                  onChange={(event) => updateCreateField("priceUsd")(readValue(event))}
                />
              </div>
              {createForm.kind === "fixed_bundle" ? (
                <>
                  <div className="space-y-2">
                    <Label>Included product</Label>
                    <select
                      value={createForm.componentProductId}
                      onChange={(event) => {
                        const componentProductId = readValue(event)
                        const product = products.find(
                          (item) => item.id === componentProductId
                        )
                        setCreateForm((prev) => ({
                          ...prev,
                          componentProductId,
                          componentVariantId: product?.variants?.[0]?.id ?? "",
                        }))
                      }}
                      className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.title ?? product.handle ?? product.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Included variant</Label>
                    <select
                      value={createForm.componentVariantId}
                      onChange={(event) =>
                        updateCreateField("componentVariantId")(readValue(event))
                      }
                      className="min-h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-base px-2 text-ui-fg-base"
                    >
                      <option value="">Product only</option>
                      {products
                        .find((product) => product.id === createForm.componentProductId)
                        ?.variants?.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {formatVariantLabel(variant)}
                          </option>
                        ))}
                    </select>
                  </div>
                </>
              ) : null}
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={createForm.description}
                  rows={4}
                  onChange={(event) =>
                    updateCreateField("description")(readValue(event))
                  }
                />
              </div>
            </div>
          </FocusModal.Body>
          <FocusModal.Footer>
            <FocusModal.Close asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </FocusModal.Close>
            <Button type="button" disabled={creating} onClick={createProduct}>
              {creating ? "Creating..." : "Create draft"}
            </Button>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
})

ProductAuthoringPage.displayName = "ProductAuthoringPage"

export const config = defineRouteConfig({
  label: "Product Authoring",
  icon: ArchiveBox,
})

export default ProductAuthoringPage
