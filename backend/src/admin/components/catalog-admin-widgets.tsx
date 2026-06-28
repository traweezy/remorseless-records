"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Container,
  DatePicker,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

import RichTextEditor from "./rich-text-editor"

const referenceKinds = [
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
] as const

const bundleTypes = ["fixed", "mystery", "deal", "selectable"] as const
const bundleInventoryModes = ["component_derived", "manual"] as const
const bundleFulfillmentModes = ["ship_components", "manual"] as const

type ReferenceKind = (typeof referenceKinds)[number]
type BundleType = (typeof bundleTypes)[number]
type BundleInventoryMode = (typeof bundleInventoryModes)[number]
type BundleFulfillmentMode = (typeof bundleFulfillmentModes)[number]

type JsonRecord = Record<string, unknown>

type WidgetProps<TData> = {
  data?: TData
}

type AdminProduct = {
  id: string
  title?: string | null
  handle?: string | null
  thumbnail?: string | null
  variants?: AdminProductVariant[]
}

type AdminProductVariant = {
  id: string
  title?: string | null
  sku?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
  options?: {
    value?: string | null
    option?: {
      title?: string | null
    } | null
  }[]
  inventory_items?: {
    required_quantity?: number | null
    inventory?: {
      id?: string | null
      sku?: string | null
      location_levels?: {
        available_quantity?: number | null
        stocked_quantity?: number | null
      }[]
    } | null
  }[]
}

type CatalogArtist = {
  id: string
  name: string
  slug: string
  sortName: string | null
  imageUrl: string | null
  bio: string | null
  location: string | null
  metadata: JsonRecord
}

type CatalogReferenceValue = {
  id: string
  kind: ReferenceKind
  label: string
  value: string
  description: string | null
  rank: number
  isActive: boolean
  metadata: JsonRecord
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
  id: string
  productProfileId: string
  artistId: string | null
  displayName: string
  role: string
  sortOrder: number
  metadata: JsonRecord
}

type CatalogProductReference = {
  id: string
  productProfileId: string
  referenceValueId: string
  kind: ReferenceKind
  sortOrder: number
  metadata: JsonRecord
}

type CatalogVariantProfile = {
  id: string
  variantId: string
  productProfileId: string | null
  formatId: string | null
  formatDetailId: string | null
  formatLabel: string | null
  formatDetailLabel: string | null
  displayLabel: string | null
  availabilityStatus: string
  preorderAllowed: boolean
  preorderReleaseDate: string | null
  backorderAllowed: boolean
  backorderNote: string | null
  imageUrl: string | null
  metadata: JsonRecord
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
  metadata: JsonRecord
}

type CatalogBundleComponent = {
  id: string
  bundleProfileId: string
  componentProductId: string
  componentVariantId: string | null
  componentInventoryItemId: string | null
  title: string | null
  variantTitle: string | null
  sku: string | null
  quantity: number
  sortOrder: number
  isRequired: boolean
  metadata: JsonRecord
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

type ReferenceValuesResponse = {
  values: CatalogReferenceValue[]
}

type ArtistsResponse = {
  artists: CatalogArtist[]
}

type ProductsResponse = {
  products: AdminProduct[]
}

type ArtistLine = {
  key: string
  name: string
  role: string
}

type ReferenceLine = {
  key: string
  kind: ReferenceKind
  label: string
}

type TrackLine = {
  key: string
  position: string
  title: string
  duration: string
  notes: string
}

type KeyValueLine = {
  key: string
  name: string
  value: string
}

type ProductProfileForm = {
  releaseTitle: string
  label: string
  productType: string
  releaseDate: string
  releaseYear: string
  descriptionHtml: string
  searchKeywords: string
  artists: ArtistLine[]
  references: ReferenceLine[]
  tracklist: TrackLine[]
  credits: KeyValueLine[]
  pressingNotes: KeyValueLine[]
  merchDetails: KeyValueLine[]
  metadata: KeyValueLine[]
}

type BundleComponentLine = {
  key: string
  componentProductId: string
  componentVariantId: string
  quantity: string
  isRequired: boolean
}

type BundleForm = {
  enabled: boolean
  bundleType: BundleType
  inventoryMode: BundleInventoryMode
  fulfillmentMode: BundleFulfillmentMode
  displayTitle: string
  descriptionHtml: string
  isActive: boolean
  metadata: KeyValueLine[]
  components: BundleComponentLine[]
}

type VariantProfileForm = {
  format: string
  formatDetail: string
  preorderAllowed: boolean
  backorderAllowed: boolean
  customerNote: string
  imageUrl: string
  metadata: KeyValueLine[]
}

const emptyProductProfileForm: ProductProfileForm = {
  releaseTitle: "",
  label: "",
  productType: "",
  releaseDate: "",
  releaseYear: "",
  descriptionHtml: "",
  searchKeywords: "",
  artists: [],
  references: [],
  tracklist: [],
  credits: [],
  pressingNotes: [],
  merchDetails: [],
  metadata: [],
}

const emptyBundleForm: BundleForm = {
  enabled: false,
  bundleType: "fixed",
  inventoryMode: "component_derived",
  fulfillmentMode: "ship_components",
  displayTitle: "",
  descriptionHtml: "",
  isActive: true,
  metadata: [],
  components: [],
}

const emptyVariantProfileForm: VariantProfileForm = {
  format: "",
  formatDetail: "",
  preorderAllowed: false,
  backorderAllowed: false,
  customerNote: "",
  imageUrl: "",
  metadata: [],
}

const key = (): string => Math.random().toString(36).slice(2)

const toNullable = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const toDateInput = (value: string | null | undefined): string => {
  if (!value) {
    return ""
  }
  return value.slice(0, 10)
}

const toDate = (value: string): Date | null => {
  if (!value) {
    return null
  }
  return new Date(`${value}T00:00:00`)
}

const fromDate = (value: Date | null): string => {
  if (!value) {
    return ""
  }
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const readFieldValue = (event: unknown): string => {
  const source = event as {
    currentTarget?: { value?: unknown } | null
    target?: { value?: unknown } | null
  }
  const value = source.currentTarget?.value ?? source.target?.value
  return typeof value === "string" ? value : ""
}

const parseInteger = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

const parseKeywords = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const displayJsonValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

const parseValue = (value: string): unknown => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

const recordToLines = (record: JsonRecord | null | undefined): KeyValueLine[] =>
  Object.entries(record ?? {}).map(([name, value]) => ({
    key: key(),
    name,
    value: displayJsonValue(value),
  }))

const linesToRecord = (lines: KeyValueLine[]): JsonRecord =>
  lines.reduce<JsonRecord>((record, line) => {
    const name = line.name.trim()
    if (!name) {
      return record
    }
    record[name] = parseValue(line.value)
    return record
  }, {})

const tracklistToLines = (tracklist: unknown[] | null | undefined): TrackLine[] =>
  (tracklist ?? []).map((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>
      return {
        key: key(),
        position: displayJsonValue(record.position ?? record.track ?? index + 1),
        title: displayJsonValue(record.title ?? record.name ?? ""),
        duration: displayJsonValue(record.duration ?? ""),
        notes: displayJsonValue(record.notes ?? record.note ?? ""),
      }
    }
    return {
      key: key(),
      position: String(index + 1),
      title: displayJsonValue(item),
      duration: "",
      notes: "",
    }
  })

const linesToTracklist = (lines: TrackLine[]): JsonRecord[] =>
  lines
    .map((line) => ({
      position: toNullable(line.position),
      title: toNullable(line.title),
      duration: toNullable(line.duration),
      notes: toNullable(line.notes),
    }))
    .filter((line) => line.position || line.title || line.duration || line.notes)

const exactMatch = <TItem extends { label?: string; name?: string }>(
  items: TItem[],
  value: string
): TItem | undefined => {
  const needle = value.trim().toLowerCase()
  if (!needle) {
    return undefined
  }
  return items.find((item) => {
    const label = item.label ?? item.name ?? ""
    return label.trim().toLowerCase() === needle
  })
}

const fetchJson = async <TResponse,>(
  url: string,
  init?: RequestInit
): Promise<TResponse> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed with ${response.status}`)
  }
  if (response.status === 204) {
    return undefined as TResponse
  }
  return (await response.json()) as TResponse
}

const referenceLabel = (
  values: CatalogReferenceValue[],
  id: string | null | undefined
): string => {
  if (!id) {
    return ""
  }
  return values.find((value) => value.id === id)?.label ?? ""
}

const artistLabel = (
  artists: CatalogArtist[],
  id: string | null | undefined,
  fallback: string | null | undefined
): string => {
  if (!id) {
    return fallback ?? ""
  }
  return artists.find((artist) => artist.id === id)?.name ?? fallback ?? ""
}

const formatVariantOptionLabel = (variant: AdminProductVariant): string => {
  const optionValues =
    variant.options
      ?.map((option) => option.value)
      .filter((value): value is string => Boolean(value)) ?? []
  return optionValues.length ? optionValues.join(" / ") : variant.title ?? "Variant"
}

const deriveVariantLabel = (format: string, detail: string): string => {
  const cleanFormat = format.trim()
  const cleanDetail = detail.trim()
  if (cleanFormat && cleanDetail) {
    return `${cleanFormat} - ${cleanDetail}`
  }
  return cleanFormat || cleanDetail || "Set format and detail"
}

const stockSummary = (variant: AdminProductVariant | undefined): string => {
  if (!variant) {
    return "Variant data unavailable"
  }
  if (!variant.manage_inventory) {
    return "Inventory is not managed by Medusa for this variant"
  }

  const explicitQuantity = variant.inventory_quantity
  if (typeof explicitQuantity === "number") {
    return `${explicitQuantity} available from native inventory`
  }

  const totals = variant.inventory_items?.reduce(
    (acc, item) => {
      for (const level of item.inventory?.location_levels ?? []) {
        acc.available += level.available_quantity ?? 0
        acc.stocked += level.stocked_quantity ?? 0
      }
      return acc
    },
    { available: 0, stocked: 0 }
  )

  if (totals) {
    return `${totals.available} available, ${totals.stocked} stocked across locations`
  }

  return "Managed inventory is enabled; use the native Inventory section for quantities"
}

const variantAvailableQuantity = (
  variant: AdminProductVariant | undefined
): number | null => {
  if (!variant?.manage_inventory) {
    return null
  }

  if (typeof variant.inventory_quantity === "number") {
    return variant.inventory_quantity
  }

  const totals = variant.inventory_items?.reduce(
    (available, item) =>
      available +
      (item.inventory?.location_levels ?? []).reduce(
        (sum, level) => sum + (level.available_quantity ?? 0),
        0
      ),
    0
  )

  return typeof totals === "number" ? totals : null
}

const isFutureDate = (value: string | null | undefined): boolean => {
  const dateInput = toDateInput(value)
  if (!dateInput) {
    return false
  }
  return dateInput > fromDate(new Date())
}

const deriveVariantCustomerState = (input: {
  releaseDate: string | null | undefined
  preorderAllowed: boolean
  backorderAllowed: boolean
  nativeBackorderAllowed: boolean
  variant: AdminProductVariant | undefined
}): { label: string; description: string } => {
  const releaseDate = toDateInput(input.releaseDate)
  const futureRelease = isFutureDate(releaseDate)
  const quantity = variantAvailableQuantity(input.variant)
  const backorderEligible =
    input.backorderAllowed || input.nativeBackorderAllowed || false

  if (futureRelease) {
    if (input.preorderAllowed) {
      return {
        label: "Preorder",
        description: `Release date is ${releaseDate}; customers can buy before release.`,
      }
    }
    return {
      label: "Coming soon",
      description: `Release date is ${releaseDate}; preorder is not enabled.`,
    }
  }

  if (!input.variant?.manage_inventory) {
    return {
      label: "Available",
      description: "Medusa inventory is not managed for this variant.",
    }
  }

  if (quantity === null) {
    return {
      label: "Inventory managed",
      description: "Use native inventory levels for exact storefront availability.",
    }
  }

  if (quantity > 0) {
    return {
      label: quantity <= 3 ? "Low stock" : "In stock",
      description: `${quantity} available through native inventory.`,
    }
  }

  if (backorderEligible) {
    return {
      label: "Backorder",
      description: "Stock is zero and backorder eligibility is enabled.",
    }
  }

  return {
    label: "Sold out",
    description: "Stock is zero and backorder eligibility is disabled.",
  }
}

const makeNamedReferencePayload = (
  values: CatalogReferenceValue[],
  kind: Extract<ReferenceKind, "label" | "product_type" | "format" | "format_detail">,
  label: string
) => {
  const trimmed = label.trim()
  if (!trimmed) {
    return {
      id: null,
      reference: null,
    }
  }
  const matched = exactMatch(
    values.filter((value) => value.kind === kind),
    trimmed
  )
  return {
    id: matched?.id ?? undefined,
    reference: matched
      ? undefined
      : {
          label: trimmed,
          value: trimmed,
        },
  }
}

const Field = memo<{
  label: string
  children: React.ReactNode
  description?: string | undefined
}>(({ label, children, description }) => (
  <div className="flex flex-col gap-y-1.5">
    <Label>{label}</Label>
    {children}
    {description ? (
      <Text size="xsmall" className="text-ui-fg-subtle">
        {description}
      </Text>
    ) : null}
  </div>
))

Field.displayName = "Field"

const DateField = memo<{
  label: string
  value: string
  onChange: (value: string) => void
  description?: string
}>(({ label, value, onChange, description }) => (
  <Field label={label} description={description}>
    <DatePicker value={toDate(value)} onChange={(date) => onChange(fromDate(date))} />
  </Field>
))

DateField.displayName = "DateField"

const ReferenceDatalist = memo<{
  id: string
  kind?: ReferenceKind
  values: CatalogReferenceValue[]
}>(({ id, kind, values }) => {
  const options = kind ? values.filter((value) => value.kind === kind) : values
  return (
    <datalist id={id}>
      {options.map((value) => (
        <option key={value.id} value={value.label} />
      ))}
    </datalist>
  )
})

ReferenceDatalist.displayName = "ReferenceDatalist"

const ArtistDatalist = memo<{
  id: string
  artists: CatalogArtist[]
}>(({ id, artists }) => (
  <datalist id={id}>
    {artists.map((artist) => (
      <option key={artist.id} value={artist.name} />
    ))}
  </datalist>
))

ArtistDatalist.displayName = "ArtistDatalist"

const KeyValueEditor = memo<{
  title: string
  lines: KeyValueLine[]
  onChange: (lines: KeyValueLine[]) => void
}>(({ title, lines, onChange }) => {
  const addLine = useCallback(() => {
    onChange([...lines, { key: key(), name: "", value: "" }])
  }, [lines, onChange])

  const updateLine = useCallback(
    (lineKey: string, patch: Partial<KeyValueLine>) => {
      onChange(lines.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)))
    },
    [lines, onChange]
  )

  const removeLine = useCallback(
    (lineKey: string) => {
      onChange(lines.filter((line) => line.key !== lineKey))
    },
    [lines, onChange]
  )

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center justify-between gap-x-3">
        <Heading level="h3">{title}</Heading>
        <Button type="button" size="small" variant="secondary" onClick={addLine}>
          Add field
        </Button>
      </div>
      {lines.length ? (
        <div className="overflow-hidden rounded-md border border-ui-border-base">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Field</Table.HeaderCell>
                <Table.HeaderCell>Value</Table.HeaderCell>
                <Table.HeaderCell className="w-[96px]" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {lines.map((line) => (
                <Table.Row key={line.key}>
                  <Table.Cell>
                    <Input
                      value={line.name}
                      onChange={(event) =>
                        updateLine(line.key, { name: readFieldValue(event) })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Textarea
                      value={line.value}
                      onChange={(event) =>
                        updateLine(line.key, { value: readFieldValue(event) })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      type="button"
                      size="small"
                      variant="transparent"
                      onClick={() => removeLine(line.key)}
                    >
                      Remove
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      ) : (
        <Text size="small" className="text-ui-fg-subtle">
          No structured fields yet.
        </Text>
      )}
    </div>
  )
})

KeyValueEditor.displayName = "KeyValueEditor"

const toProductProfileForm = (
  response: ProductProfileResponse,
  artists: CatalogArtist[],
  values: CatalogReferenceValue[]
): ProductProfileForm => {
  const profile = response.profile
  return {
    releaseTitle: profile?.releaseTitle ?? "",
    label: referenceLabel(values, profile?.labelId),
    productType: referenceLabel(values, profile?.productTypeId),
    releaseDate: toDateInput(profile?.releaseDate),
    releaseYear: profile?.releaseYear ? String(profile.releaseYear) : "",
    descriptionHtml: profile?.descriptionHtml ?? "",
    searchKeywords: profile?.searchKeywords?.join(", ") ?? "",
    artists: response.artists.map((artist) => ({
      key: key(),
      name: artistLabel(artists, artist.artistId, artist.displayName),
      role: artist.role || "primary",
    })),
    references: response.references.map((reference) => ({
      key: key(),
      kind: reference.kind,
      label: referenceLabel(values, reference.referenceValueId),
    })),
    tracklist: tracklistToLines(profile?.tracklist),
    credits: recordToLines(profile?.credits),
    pressingNotes: recordToLines(profile?.pressingNotes),
    merchDetails: recordToLines(profile?.merchDetails),
    metadata: recordToLines(profile?.metadata),
  }
}

const toBundleForm = (response: BundleResponse): BundleForm => ({
  enabled: Boolean(response.bundle),
  bundleType: response.bundle?.bundleType ?? "fixed",
  inventoryMode: response.bundle?.inventoryMode ?? "component_derived",
  fulfillmentMode: response.bundle?.fulfillmentMode ?? "ship_components",
  displayTitle: response.bundle?.displayTitle ?? "",
  descriptionHtml: response.bundle?.descriptionHtml ?? "",
  isActive: response.bundle?.isActive ?? true,
  metadata: recordToLines(response.bundle?.metadata),
  components: response.components.map((component) => ({
    key: key(),
    componentProductId: component.componentProductId,
    componentVariantId: component.componentVariantId ?? "",
    quantity: String(component.quantity ?? 1),
    isRequired: component.isRequired ?? true,
  })),
})

const toVariantProfileForm = (profile: CatalogVariantProfile | null): VariantProfileForm => ({
  format: profile?.formatLabel ?? "",
  formatDetail: profile?.formatDetailLabel ?? "",
  preorderAllowed: Boolean(
    profile?.preorderAllowed || profile?.availabilityStatus === "preorder"
  ),
  backorderAllowed: Boolean(
    profile?.backorderAllowed || profile?.availabilityStatus === "backorder"
  ),
  customerNote: profile?.backorderNote ?? "",
  imageUrl: profile?.imageUrl ?? "",
  metadata: recordToLines(profile?.metadata),
})

const buildProductProfilePayload = (
  form: ProductProfileForm,
  artists: CatalogArtist[],
  values: CatalogReferenceValue[]
) => {
  const label = makeNamedReferencePayload(values, "label", form.label)
  const productType = makeNamedReferencePayload(values, "product_type", form.productType)

  return {
    releaseTitle: toNullable(form.releaseTitle),
    labelId: label.id,
    label: label.reference,
    productTypeId: productType.id,
    productType: productType.reference,
    releaseDate: toNullable(form.releaseDate),
    releaseYear: parseInteger(form.releaseYear),
    descriptionHtml: toNullable(form.descriptionHtml),
    searchKeywords: parseKeywords(form.searchKeywords),
    tracklist: linesToTracklist(form.tracklist),
    credits: linesToRecord(form.credits),
    pressingNotes: linesToRecord(form.pressingNotes),
    merchDetails: linesToRecord(form.merchDetails),
    metadata: linesToRecord(form.metadata),
    artists: form.artists
      .map((line, index) => {
        const name = line.name.trim()
        if (!name) {
          return null
        }
        const matched = exactMatch(artists, name)
        return {
          artistId: matched?.id,
          name: matched ? undefined : name,
          displayName: name,
          role: line.role.trim() || "primary",
          sortOrder: index,
        }
      })
      .filter(Boolean),
    references: form.references
      .map((line, index) => {
        const labelValue = line.label.trim()
        if (!labelValue) {
          return null
        }
        const matched = exactMatch(
          values.filter((value) => value.kind === line.kind),
          labelValue
        )
        return {
          referenceValueId: matched?.id,
          kind: line.kind,
          label: matched ? undefined : labelValue,
          value: matched ? undefined : labelValue,
          sortOrder: index,
        }
      })
      .filter(Boolean),
  }
}

const buildBundlePayload = (
  form: BundleForm,
  productProfileId: string | null | undefined,
  products: AdminProduct[]
) => ({
  productProfileId: productProfileId ?? null,
  bundleType: form.bundleType,
  inventoryMode: form.bundleType === "mystery" ? "manual" : form.inventoryMode,
  fulfillmentMode: form.bundleType === "mystery" ? "manual" : form.fulfillmentMode,
  displayTitle: toNullable(form.displayTitle),
  descriptionHtml: toNullable(form.descriptionHtml),
  isActive: form.isActive,
  metadata: linesToRecord(form.metadata),
  components:
    form.bundleType === "mystery"
      ? []
      : form.components
          .filter((line) => line.componentProductId.trim())
          .map((line, index) => {
            const product = products.find((item) => item.id === line.componentProductId)
            const variant = product?.variants?.find(
              (item) => item.id === line.componentVariantId
            )
            return {
              componentProductId: line.componentProductId,
              componentVariantId: toNullable(line.componentVariantId),
              title: product?.title ?? null,
              variantTitle: variant ? formatVariantOptionLabel(variant) : null,
              sku: variant?.sku ?? null,
              quantity: parseInteger(line.quantity) ?? 1,
              sortOrder: index,
              isRequired: line.isRequired,
            }
          })
})

const buildVariantProfilePayload = (
  form: VariantProfileForm,
  variant: AdminProductVariant | undefined,
  values: CatalogReferenceValue[]
) => {
  const format = makeNamedReferencePayload(values, "format", form.format)
  const detail = makeNamedReferencePayload(values, "format_detail", form.formatDetail)

  return {
    productId: variant?.product_id,
    formatId: format.id,
    format: format.reference,
    formatDetailId: detail.id,
    formatDetail: detail.reference,
    formatLabel: toNullable(form.format),
    formatDetailLabel: toNullable(form.formatDetail),
    displayLabel: null,
    preorderAllowed: form.preorderAllowed,
    preorderReleaseDate: null,
    backorderAllowed: form.backorderAllowed,
    backorderNote:
      form.backorderAllowed || form.preorderAllowed
        ? toNullable(form.customerNote)
        : null,
    imageUrl: toNullable(form.imageUrl),
    metadata: linesToRecord(form.metadata),
  }
}

const SummaryItem = memo<{
  label: string
  value: string
}>(({ label, value }) => (
  <div>
    <Text size="xsmall" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small">{value || "Not set"}</Text>
  </div>
))

SummaryItem.displayName = "SummaryItem"

export const ProductCatalogProfileWidget = memo<WidgetProps<AdminProduct>>(({ data }) => {
  const productId = data?.id
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileResponse, setProfileResponse] = useState<ProductProfileResponse>({
    profile: null,
    artists: [],
    references: [],
  })
  const [bundleResponse, setBundleResponse] = useState<BundleResponse>({
    bundle: null,
    components: [],
  })
  const [artists, setArtists] = useState<CatalogArtist[]>([])
  const [referenceValues, setReferenceValues] = useState<CatalogReferenceValue[]>([])
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [profileForm, setProfileForm] = useState<ProductProfileForm>(
    emptyProductProfileForm
  )
  const [bundleForm, setBundleForm] = useState<BundleForm>(emptyBundleForm)

  const load = useCallback(async () => {
    if (!productId) {
      return
    }
    setLoading(true)
    try {
      const [profile, bundle, artistList, referenceList, productList] =
        await Promise.all([
          fetchJson<ProductProfileResponse>(
            `/admin/catalog/products/${productId}/profile`
          ),
          fetchJson<BundleResponse>(`/admin/catalog/products/${productId}/bundle`),
          fetchJson<ArtistsResponse>("/admin/catalog/artists?limit=500"),
          fetchJson<ReferenceValuesResponse>(
            "/admin/catalog/reference-values?limit=500&active=true"
          ),
          fetchJson<ProductsResponse>(
            "/admin/products?limit=500&fields=id,title,handle,thumbnail,*variants"
          ),
        ])

      setProfileResponse(profile)
      setBundleResponse(bundle)
      setArtists(artistList.artists)
      setReferenceValues(referenceList.values)
      setProducts(productList.products)
      setProfileForm(toProductProfileForm(profile, artistList.artists, referenceList.values))
      setBundleForm(toBundleForm(bundle))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load catalog profile")
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  const artistNames = useMemo(
    () =>
      profileForm.artists
        .map((artist) => artist.name.trim())
        .filter(Boolean)
        .join(", "),
    [profileForm.artists]
  )

  const genreLabels = useMemo(
    () =>
      profileForm.references
        .filter((reference) => reference.kind === "genre")
        .map((reference) => reference.label.trim())
        .filter(Boolean)
        .join(", "),
    [profileForm.references]
  )

  const updateProfile = useCallback(
    <TKey extends keyof ProductProfileForm>(
      field: TKey,
      value: ProductProfileForm[TKey]
    ) => {
      setProfileForm((previous) => ({
        ...previous,
        [field]: value,
      }))
    },
    []
  )

  const updateBundle = useCallback(
    <TKey extends keyof BundleForm>(field: TKey, value: BundleForm[TKey]) => {
      setBundleForm((previous) => ({
        ...previous,
        [field]: value,
      }))
    },
    []
  )

  const save = useCallback(async () => {
    if (!productId) {
      return
    }
    setSaving(true)
    try {
      const profile = await fetchJson<ProductProfileResponse>(
        `/admin/catalog/products/${productId}/profile`,
        {
          method: "PUT",
          body: JSON.stringify(
            buildProductProfilePayload(profileForm, artists, referenceValues)
          ),
        }
      )

      if (bundleForm.enabled) {
        await fetchJson<BundleResponse>(`/admin/catalog/products/${productId}/bundle`, {
          method: "PUT",
          body: JSON.stringify(
            buildBundlePayload(bundleForm, profile.profile?.id, products)
          ),
        })
      } else if (bundleResponse.bundle) {
        await fetchJson<void>(`/admin/catalog/products/${productId}/bundle`, {
          method: "DELETE",
        })
      }

      toast.success("Saved catalog profile")
      setOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save catalog profile")
    } finally {
      setSaving(false)
    }
  }, [
    artists,
    bundleForm,
    bundleResponse.bundle,
    load,
    productId,
    products,
    profileForm,
    referenceValues,
  ])

  const addArtist = useCallback(() => {
    updateProfile("artists", [
      ...profileForm.artists,
      { key: key(), name: "", role: "primary" },
    ])
  }, [profileForm.artists, updateProfile])

  const updateArtist = useCallback(
    (lineKey: string, patch: Partial<ArtistLine>) => {
      updateProfile(
        "artists",
        profileForm.artists.map((line) =>
          line.key === lineKey ? { ...line, ...patch } : line
        )
      )
    },
    [profileForm.artists, updateProfile]
  )

  const removeArtist = useCallback(
    (lineKey: string) => {
      updateProfile(
        "artists",
        profileForm.artists.filter((line) => line.key !== lineKey)
      )
    },
    [profileForm.artists, updateProfile]
  )

  const addReference = useCallback(
    (kind: ReferenceKind) => {
      updateProfile("references", [
        ...profileForm.references,
        { key: key(), kind, label: "" },
      ])
    },
    [profileForm.references, updateProfile]
  )

  const updateReference = useCallback(
    (lineKey: string, patch: Partial<ReferenceLine>) => {
      updateProfile(
        "references",
        profileForm.references.map((line) =>
          line.key === lineKey ? { ...line, ...patch } : line
        )
      )
    },
    [profileForm.references, updateProfile]
  )

  const removeReference = useCallback(
    (lineKey: string) => {
      updateProfile(
        "references",
        profileForm.references.filter((line) => line.key !== lineKey)
      )
    },
    [profileForm.references, updateProfile]
  )

  const addTrack = useCallback(() => {
    updateProfile("tracklist", [
      ...profileForm.tracklist,
      { key: key(), position: "", title: "", duration: "", notes: "" },
    ])
  }, [profileForm.tracklist, updateProfile])

  const updateTrack = useCallback(
    (lineKey: string, patch: Partial<TrackLine>) => {
      updateProfile(
        "tracklist",
        profileForm.tracklist.map((line) =>
          line.key === lineKey ? { ...line, ...patch } : line
        )
      )
    },
    [profileForm.tracklist, updateProfile]
  )

  const removeTrack = useCallback(
    (lineKey: string) => {
      updateProfile(
        "tracklist",
        profileForm.tracklist.filter((line) => line.key !== lineKey)
      )
    },
    [profileForm.tracklist, updateProfile]
  )

  const addBundleComponent = useCallback(() => {
    updateBundle("components", [
      ...bundleForm.components,
      {
        key: key(),
        componentProductId: "",
        componentVariantId: "",
        quantity: "1",
        isRequired: true,
      },
    ])
  }, [bundleForm.components, updateBundle])

  const updateBundleComponent = useCallback(
    (lineKey: string, patch: Partial<BundleComponentLine>) => {
      updateBundle(
        "components",
        bundleForm.components.map((line) =>
          line.key === lineKey ? { ...line, ...patch } : line
        )
      )
    },
    [bundleForm.components, updateBundle]
  )

  const removeBundleComponent = useCallback(
    (lineKey: string) => {
      updateBundle(
        "components",
        bundleForm.components.filter((line) => line.key !== lineKey)
      )
    },
    [bundleForm.components, updateBundle]
  )

  if (!productId) {
    return null
  }

  return (
    <>
      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex items-start justify-between gap-x-4 px-6 py-4">
          <div>
            <Heading level="h2">Catalog profile</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Normalized release, artist, genre, and bundle data for the storefront.
            </Text>
          </div>
          <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
            Edit catalog profile
          </Button>
        </div>
        <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
          <SummaryItem label="Release title" value={profileForm.releaseTitle || data.title || ""} />
          <SummaryItem label="Artists" value={artistNames} />
          <SummaryItem label="Release date" value={profileForm.releaseDate} />
          <SummaryItem label="Genres" value={genreLabels} />
          <SummaryItem label="Label" value={profileForm.label} />
          <SummaryItem label="Product type" value={profileForm.productType} />
        </div>
        <div className="flex flex-wrap gap-2 px-6 py-4">
          {bundleForm.enabled ? (
            <StatusBadge color={bundleForm.isActive ? "green" : "grey"}>
              Bundle profile enabled
            </StatusBadge>
          ) : (
            <StatusBadge color="grey">Standalone product</StatusBadge>
          )}
          {profileResponse.profile ? (
            <Badge color="blue">Catalog data saved</Badge>
          ) : (
            <Badge color="orange">Catalog data incomplete</Badge>
          )}
        </div>
      </Container>

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Edit catalog profile</Drawer.Title>
            <Drawer.Description>
              Keep Medusa product basics in the default forms. Use this panel for normalized catalog data.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
            <ArtistDatalist id="catalog-product-artists" artists={artists} />
            {referenceKinds.map((kind) => (
              <ReferenceDatalist
                key={`catalog-reference-${kind}`}
                id={`catalog-reference-${kind}`}
                kind={kind}
                values={referenceValues}
              />
            ))}

            {loading ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading catalog profile...
              </Text>
            ) : null}

            <Tabs defaultValue="release" className="flex flex-col gap-y-6">
              <Tabs.List>
                <Tabs.Trigger value="release">Release</Tabs.Trigger>
                <Tabs.Trigger value="taxonomy">Taxonomy</Tabs.Trigger>
                <Tabs.Trigger value="details">Details</Tabs.Trigger>
                <Tabs.Trigger value="bundle">Bundle</Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="release" className="flex flex-col gap-y-5">
                <Field label="Release title" description="Artist names stay out of the title field.">
                  <Input
                    value={profileForm.releaseTitle}
                    onChange={(event) =>
                      updateProfile("releaseTitle", readFieldValue(event))
                    }
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Label">
                    <Input
                      list="catalog-reference-label"
                      value={profileForm.label}
                      onChange={(event) =>
                        updateProfile("label", readFieldValue(event))
                      }
                    />
                  </Field>
                  <Field label="Product type">
                    <Input
                      list="catalog-reference-product_type"
                      value={profileForm.productType}
                      onChange={(event) =>
                        updateProfile("productType", readFieldValue(event))
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <DateField
                    label="Release date"
                    value={profileForm.releaseDate}
                    onChange={(value) => updateProfile("releaseDate", value)}
                  />
                  <Field label="Release year">
                    <Input
                      type="number"
                      min={1900}
                      max={2200}
                      value={profileForm.releaseYear}
                      onChange={(event) =>
                        updateProfile("releaseYear", readFieldValue(event))
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Rich description"
                  description="Stored as catalog rich text HTML for the storefront."
                >
                  <RichTextEditor
                    value={profileForm.descriptionHtml}
                    onChange={(value) => updateProfile("descriptionHtml", value)}
                    placeholder="Use headings, lists, quotes, and links where useful."
                  />
                </Field>
                <Field label="Search keywords">
                  <Input
                    value={profileForm.searchKeywords}
                    onChange={(event) =>
                      updateProfile("searchKeywords", readFieldValue(event))
                    }
                    placeholder="comma, separated, terms"
                  />
                </Field>
              </Tabs.Content>

              <Tabs.Content value="taxonomy" className="flex flex-col gap-y-6">
                <div className="flex items-center justify-between gap-x-3">
                  <Heading level="h3">Artists</Heading>
                  <Button type="button" size="small" variant="secondary" onClick={addArtist}>
                    Add artist
                  </Button>
                </div>
                {profileForm.artists.length ? (
                  <div className="overflow-hidden rounded-md border border-ui-border-base">
                    <Table>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Artist</Table.HeaderCell>
                          <Table.HeaderCell>Role</Table.HeaderCell>
                          <Table.HeaderCell className="w-[96px]" />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {profileForm.artists.map((line) => (
                          <Table.Row key={line.key}>
                            <Table.Cell>
                              <Input
                                list="catalog-product-artists"
                                value={line.name}
                                onChange={(event) =>
                                  updateArtist(line.key, {
                                    name: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                value={line.role}
                                onChange={(event) =>
                                  updateArtist(line.key, {
                                    role: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Button
                                type="button"
                                size="small"
                                variant="transparent"
                                onClick={() => removeArtist(line.key)}
                              >
                                Remove
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Add one or more artists. Existing artists autocomplete; new names are created on save.
                  </Text>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="small" variant="secondary" onClick={() => addReference("genre")}>
                    Add genre
                  </Button>
                  <Button type="button" size="small" variant="secondary" onClick={() => addReference("utility_tag")}>
                    Add tag
                  </Button>
                  <Button type="button" size="small" variant="secondary" onClick={() => addReference("merch_type")}>
                    Add merch type
                  </Button>
                </div>
                {profileForm.references.length ? (
                  <div className="overflow-hidden rounded-md border border-ui-border-base">
                    <Table>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Kind</Table.HeaderCell>
                          <Table.HeaderCell>Value</Table.HeaderCell>
                          <Table.HeaderCell className="w-[96px]" />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {profileForm.references.map((line) => (
                          <Table.Row key={line.key}>
                            <Table.Cell>
                              <Select
                                value={line.kind}
                                onValueChange={(value) =>
                                  updateReference(line.key, {
                                    kind: value as ReferenceKind,
                                    label: "",
                                  })
                                }
                              >
                                <Select.Trigger>
                                  <Select.Value />
                                </Select.Trigger>
                                <Select.Content>
                                  {referenceKinds.map((kind) => (
                                    <Select.Item key={kind} value={kind}>
                                      {kind.replaceAll("_", " ")}
                                    </Select.Item>
                                  ))}
                                </Select.Content>
                              </Select>
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                list={`catalog-reference-${line.kind}`}
                                value={line.label}
                                onChange={(event) =>
                                  updateReference(line.key, {
                                    label: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Button
                                type="button"
                                size="small"
                                variant="transparent"
                                onClick={() => removeReference(line.key)}
                              >
                                Remove
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Add genres, storefront tags, or merch types. Existing values autocomplete; new values are created on save.
                  </Text>
                )}
              </Tabs.Content>

              <Tabs.Content value="details" className="flex flex-col gap-y-6">
                <div className="flex items-center justify-between gap-x-3">
                  <Heading level="h3">Tracklist</Heading>
                  <Button type="button" size="small" variant="secondary" onClick={addTrack}>
                    Add track
                  </Button>
                </div>
                {profileForm.tracklist.length ? (
                  <div className="overflow-hidden rounded-md border border-ui-border-base">
                    <Table>
                      <Table.Header>
                        <Table.Row>
                          <Table.HeaderCell>Position</Table.HeaderCell>
                          <Table.HeaderCell>Title</Table.HeaderCell>
                          <Table.HeaderCell>Duration</Table.HeaderCell>
                          <Table.HeaderCell>Notes</Table.HeaderCell>
                          <Table.HeaderCell className="w-[96px]" />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {profileForm.tracklist.map((line) => (
                          <Table.Row key={line.key}>
                            <Table.Cell>
                              <Input
                                value={line.position}
                                onChange={(event) =>
                                  updateTrack(line.key, {
                                    position: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                value={line.title}
                                onChange={(event) =>
                                  updateTrack(line.key, {
                                    title: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                value={line.duration}
                                onChange={(event) =>
                                  updateTrack(line.key, {
                                    duration: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Input
                                value={line.notes}
                                onChange={(event) =>
                                  updateTrack(line.key, {
                                    notes: readFieldValue(event),
                                  })
                                }
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Button
                                type="button"
                                size="small"
                                variant="transparent"
                                onClick={() => removeTrack(line.key)}
                              >
                                Remove
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table>
                  </div>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    Add track rows for music releases.
                  </Text>
                )}
                <KeyValueEditor
                  title="Credits"
                  lines={profileForm.credits}
                  onChange={(lines) => updateProfile("credits", lines)}
                />
                <KeyValueEditor
                  title="Pressing notes"
                  lines={profileForm.pressingNotes}
                  onChange={(lines) => updateProfile("pressingNotes", lines)}
                />
                <KeyValueEditor
                  title="Merch details"
                  lines={profileForm.merchDetails}
                  onChange={(lines) => updateProfile("merchDetails", lines)}
                />
                <KeyValueEditor
                  title="Internal metadata"
                  lines={profileForm.metadata}
                  onChange={(lines) => updateProfile("metadata", lines)}
                />
              </Tabs.Content>

              <Tabs.Content value="bundle" className="flex flex-col gap-y-6">
                <div className="flex items-center justify-between gap-x-3 rounded-md border border-ui-border-base p-4">
                  <div>
                    <Heading level="h3">Bundle profile</Heading>
                    <Text size="small" className="text-ui-fg-subtle">
                      Use this only when this product is sold as a grouped offering.
                    </Text>
                  </div>
                  <Switch
                    checked={bundleForm.enabled}
                    onCheckedChange={(checked) => updateBundle("enabled", Boolean(checked))}
                  />
                </div>
                {bundleForm.enabled ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Bundle type">
                        <Select
                          value={bundleForm.bundleType}
                          onValueChange={(value) =>
                            updateBundle("bundleType", value as BundleType)
                          }
                        >
                          <Select.Trigger>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            {bundleTypes.map((type) => (
                              <Select.Item key={type} value={type}>
                                {type.replaceAll("_", " ")}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Field>
                      <Field label="Display title">
                        <Input
                          value={bundleForm.displayTitle}
                          onChange={(event) =>
                            updateBundle("displayTitle", readFieldValue(event))
                          }
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Inventory mode">
                        <Select
                          value={bundleForm.inventoryMode}
                          disabled={bundleForm.bundleType === "mystery"}
                          onValueChange={(value) =>
                            updateBundle("inventoryMode", value as BundleInventoryMode)
                          }
                        >
                          <Select.Trigger>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            {bundleInventoryModes.map((mode) => (
                              <Select.Item key={mode} value={mode}>
                                {mode.replaceAll("_", " ")}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Field>
                      <Field label="Fulfillment mode">
                        <Select
                          value={bundleForm.fulfillmentMode}
                          disabled={bundleForm.bundleType === "mystery"}
                          onValueChange={(value) =>
                            updateBundle("fulfillmentMode", value as BundleFulfillmentMode)
                          }
                        >
                          <Select.Trigger>
                            <Select.Value />
                          </Select.Trigger>
                          <Select.Content>
                            {bundleFulfillmentModes.map((mode) => (
                              <Select.Item key={mode} value={mode}>
                                {mode.replaceAll("_", " ")}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
                      </Field>
                    </div>
                    <div className="flex items-center justify-between gap-x-3 rounded-md border border-ui-border-base p-4">
                      <div>
                        <Text weight="plus">Active bundle</Text>
                        <Text size="small" className="text-ui-fg-subtle">
                          Inactive bundles keep their configuration but should not be surfaced.
                        </Text>
                      </div>
                      <Switch
                        checked={bundleForm.isActive}
                        onCheckedChange={(checked) =>
                          updateBundle("isActive", Boolean(checked))
                        }
                      />
                    </div>
                    <Field label="Bundle rich description">
                      <RichTextEditor
                        value={bundleForm.descriptionHtml}
                        onChange={(value) => updateBundle("descriptionHtml", value)}
                      />
                    </Field>
                    {bundleForm.bundleType !== "mystery" ? (
                      <>
                        <div className="flex items-center justify-between gap-x-3">
                          <Heading level="h3">Included products</Heading>
                          <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={addBundleComponent}
                          >
                            Add included item
                          </Button>
                        </div>
                        {bundleForm.components.length ? (
                          <div className="overflow-hidden rounded-md border border-ui-border-base">
                            <Table>
                              <Table.Header>
                                <Table.Row>
                                  <Table.HeaderCell>Product</Table.HeaderCell>
                                  <Table.HeaderCell>Variant</Table.HeaderCell>
                                  <Table.HeaderCell>Qty</Table.HeaderCell>
                                  <Table.HeaderCell>Required</Table.HeaderCell>
                                  <Table.HeaderCell className="w-[96px]" />
                                </Table.Row>
                              </Table.Header>
                              <Table.Body>
                                {bundleForm.components.map((line) => {
                                  const selectedProduct = products.find(
                                    (product) => product.id === line.componentProductId
                                  )
                                  return (
                                    <Table.Row key={line.key}>
                                      <Table.Cell>
                                        <Select
                                          value={line.componentProductId}
                                          onValueChange={(value) =>
                                            updateBundleComponent(line.key, {
                                              componentProductId: value,
                                              componentVariantId: "",
                                            })
                                          }
                                        >
                                          <Select.Trigger>
                                            <Select.Value placeholder="Select product" />
                                          </Select.Trigger>
                                          <Select.Content>
                                            {products
                                              .filter((product) => product.id !== productId)
                                              .map((product) => (
                                                <Select.Item key={product.id} value={product.id}>
                                                  {product.title ?? product.id}
                                                </Select.Item>
                                              ))}
                                          </Select.Content>
                                        </Select>
                                      </Table.Cell>
                                      <Table.Cell>
                                        <Select
                                          value={line.componentVariantId || "__any__"}
                                          disabled={!selectedProduct?.variants?.length}
                                          onValueChange={(value) =>
                                            updateBundleComponent(line.key, {
                                              componentVariantId:
                                                value === "__any__" ? "" : value,
                                            })
                                          }
                                        >
                                          <Select.Trigger>
                                            <Select.Value placeholder="Any variant" />
                                          </Select.Trigger>
                                          <Select.Content>
                                            <Select.Item value="__any__">
                                              Any variant
                                            </Select.Item>
                                            {(selectedProduct?.variants ?? []).map((variant) => (
                                              <Select.Item key={variant.id} value={variant.id}>
                                                {formatVariantOptionLabel(variant)}
                                              </Select.Item>
                                            ))}
                                          </Select.Content>
                                        </Select>
                                      </Table.Cell>
                                      <Table.Cell>
                                        <Input
                                          type="number"
                                          min={1}
                                          value={line.quantity}
                                          onChange={(event) =>
                                            updateBundleComponent(line.key, {
                                              quantity: readFieldValue(event),
                                            })
                                          }
                                        />
                                      </Table.Cell>
                                      <Table.Cell>
                                        <Switch
                                          checked={line.isRequired}
                                          onCheckedChange={(checked) =>
                                            updateBundleComponent(line.key, {
                                              isRequired: Boolean(checked),
                                            })
                                          }
                                        />
                                      </Table.Cell>
                                      <Table.Cell>
                                        <Button
                                          type="button"
                                          size="small"
                                          variant="transparent"
                                          onClick={() => removeBundleComponent(line.key)}
                                        >
                                          Remove
                                        </Button>
                                      </Table.Cell>
                                    </Table.Row>
                                  )
                                })}
                              </Table.Body>
                            </Table>
                          </div>
                        ) : (
                          <Text size="small" className="text-ui-fg-subtle">
                            Fixed, deal, and selectable bundles need at least one included product.
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text size="small" className="text-ui-fg-subtle">
                        Mystery bundles are handled manually and do not require component selection.
                      </Text>
                    )}
                    <KeyValueEditor
                      title="Bundle metadata"
                      lines={bundleForm.metadata}
                      onChange={(lines) => updateBundle("metadata", lines)}
                    />
                  </>
                ) : null}
              </Tabs.Content>
            </Tabs>
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Drawer.Close>
            <Button type="button" onClick={save} isLoading={saving}>
              Save catalog profile
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </>
  )
})

ProductCatalogProfileWidget.displayName = "ProductCatalogProfileWidget"

export const VariantCatalogProfileWidget = memo<WidgetProps<AdminProductVariant>>(
  ({ data }) => {
    const variantId = data?.id
    const productId = data?.product_id
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [profile, setProfile] = useState<CatalogVariantProfile | null>(null)
    const [productProfile, setProductProfile] =
      useState<CatalogProductProfile | null>(null)
    const [referenceValues, setReferenceValues] = useState<CatalogReferenceValue[]>([])
    const [form, setForm] = useState<VariantProfileForm>(emptyVariantProfileForm)

    const load = useCallback(async () => {
      if (!variantId) {
        return
      }
      setLoading(true)
      try {
        const [variantProfile, references, productCatalogProfile] = await Promise.all([
          fetchJson<VariantProfileResponse>(
            `/admin/catalog/variants/${variantId}/profile`
          ),
          fetchJson<ReferenceValuesResponse>(
            "/admin/catalog/reference-values?limit=500&active=true"
          ),
          productId
            ? fetchJson<ProductProfileResponse>(
                `/admin/catalog/products/${productId}/profile`
              )
            : Promise.resolve<ProductProfileResponse>({
                profile: null,
                artists: [],
                references: [],
              }),
        ])
        setProfile(variantProfile.profile)
        setProductProfile(productCatalogProfile.profile)
        setReferenceValues(references.values)
        setForm(toVariantProfileForm(variantProfile.profile))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to load variant profile")
      } finally {
        setLoading(false)
      }
    }, [productId, variantId])

    useEffect(() => {
      void load()
    }, [load])

    const updateForm = useCallback(
      <TKey extends keyof VariantProfileForm>(
        field: TKey,
        value: VariantProfileForm[TKey]
      ) => {
        setForm((previous) => ({
          ...previous,
          [field]: value,
        }))
      },
      []
    )

    const save = useCallback(async () => {
      if (!variantId) {
        return
      }
      setSaving(true)
      try {
        const response = await fetchJson<VariantProfileResponse>(
          `/admin/catalog/variants/${variantId}/profile`,
          {
            method: "PUT",
            body: JSON.stringify(buildVariantProfilePayload(form, data, referenceValues)),
          }
        )
        setProfile(response.profile)
        setForm(toVariantProfileForm(response.profile))
        toast.success("Saved variant catalog profile")
        setOpen(false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save variant profile")
      } finally {
        setSaving(false)
      }
    }, [data, form, referenceValues, variantId])

    if (!variantId) {
      return null
    }

    const derivedLabel = deriveVariantLabel(form.format, form.formatDetail)
    const nativeLabel = data ? formatVariantOptionLabel(data) : "Variant"
    const releaseDate = productProfile?.releaseDate ?? null
    const releaseDateLabel = toDateInput(releaseDate)
    const releaseIsFuture = isFutureDate(releaseDate)
    const nativeBackorderAllowed = Boolean(data?.allow_backorder)
    const customerState = deriveVariantCustomerState({
      releaseDate,
      preorderAllowed: form.preorderAllowed,
      backorderAllowed: form.backorderAllowed,
      nativeBackorderAllowed,
      variant: data,
    })

    return (
      <>
        <Container className="divide-y divide-ui-border-base p-0">
          <div className="flex items-start justify-between gap-x-4 px-6 py-4">
            <div>
              <Heading level="h2">Catalog variant profile</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Format facts, purchase eligibility, and storefront variant copy.
              </Text>
            </div>
            <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
              Edit catalog variant
            </Button>
          </div>
          <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
            <SummaryItem label="Native variant" value={nativeLabel} />
            <SummaryItem label="Derived label" value={derivedLabel} />
            <SummaryItem label="Stock evidence" value={stockSummary(data)} />
            <SummaryItem label="Release date" value={releaseDateLabel} />
            <SummaryItem label="Customer state" value={customerState.label} />
            <SummaryItem label="State reason" value={customerState.description} />
          </div>
          <div className="flex flex-wrap gap-2 px-6 py-4">
            {profile ? (
              <Badge color="blue">Catalog data saved</Badge>
            ) : (
              <Badge color="orange">Catalog data incomplete</Badge>
            )}
            {profile?.displayLabel ? (
              <Badge color="orange">Manual display label will be cleared on save</Badge>
            ) : (
              <Badge color="grey">Display label is derived</Badge>
            )}
            {form.preorderAllowed ? (
              <Badge color={releaseIsFuture ? "blue" : "orange"}>
                Preorder eligibility enabled
              </Badge>
            ) : null}
            {form.backorderAllowed || nativeBackorderAllowed ? (
              <Badge color="orange">Backorder eligibility enabled</Badge>
            ) : null}
          </div>
        </Container>

        <Drawer open={open} onOpenChange={setOpen}>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title>Edit catalog variant profile</Drawer.Title>
              <Drawer.Description>
                Prices, inventory, and images remain in Medusa's native variant forms.
              </Drawer.Description>
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
              <ReferenceDatalist
                id="catalog-reference-format"
                kind="format"
                values={referenceValues}
              />
              <ReferenceDatalist
                id="catalog-reference-format_detail"
                kind="format_detail"
                values={referenceValues}
              />

              {loading ? (
                <Text size="small" className="text-ui-fg-subtle">
                  Loading variant profile...
                </Text>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Format">
                  <Input
                    list="catalog-reference-format"
                    value={form.format}
                    onChange={(event) => updateForm("format", readFieldValue(event))}
                    placeholder="Vinyl"
                  />
                </Field>
                <Field label="Format detail">
                  <Input
                    list="catalog-reference-format_detail"
                    value={form.formatDetail}
                    onChange={(event) =>
                      updateForm("formatDetail", readFieldValue(event))
                    }
                    placeholder="Black, Splatter, CD, Tape"
                  />
                </Field>
              </div>
              <div className="rounded-md border border-ui-border-base p-4">
                <Text weight="plus">Derived storefront label</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {derivedLabel}
                </Text>
              </div>
              <div className="rounded-md border border-ui-border-base p-4">
                <Text weight="plus">Native stock evidence</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {stockSummary(data)}
                </Text>
              </div>
              <div className="rounded-md border border-ui-border-base p-4">
                <Text weight="plus">Derived customer state</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {customerState.label}: {customerState.description}
                </Text>
              </div>
              <div className="flex items-center justify-between gap-x-3 rounded-md border border-ui-border-base p-4">
                <div>
                  <Text weight="plus">Available for preorder</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    Used only when the product release date is in the future.
                    If this is off, the storefront derives Coming soon.
                  </Text>
                  {!releaseIsFuture ? (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Set a future release date on the product catalog profile first.
                    </Text>
                  ) : null}
                </div>
                <Switch
                  checked={form.preorderAllowed}
                  onCheckedChange={(checked) =>
                    updateForm("preorderAllowed", Boolean(checked))
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-x-3 rounded-md border border-ui-border-base p-4">
                <div>
                  <Text weight="plus">Backorder eligible at zero stock</Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    Lets the catalog show backorder messaging when inventory is zero.
                    Checkout behavior still depends on Medusa's native Allow backorders setting.
                  </Text>
                  {nativeBackorderAllowed ? (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Native Medusa backorders are currently enabled for this variant.
                    </Text>
                  ) : null}
                </div>
                <Switch
                  checked={form.backorderAllowed}
                  onCheckedChange={(checked) =>
                    updateForm("backorderAllowed", Boolean(checked))
                  }
                />
              </div>
              {form.backorderAllowed || form.preorderAllowed ? (
                <Field label="Customer note">
                  <Textarea
                    value={form.customerNote}
                    onChange={(event) =>
                      updateForm("customerNote", readFieldValue(event))
                    }
                  />
                </Field>
              ) : null}
              <Field label="Variant-specific image URL">
                <Input
                  value={form.imageUrl}
                  onChange={(event) => updateForm("imageUrl", readFieldValue(event))}
                  placeholder="https://..."
                />
              </Field>
              <KeyValueEditor
                title="Variant metadata"
                lines={form.metadata}
                onChange={(lines) => updateForm("metadata", lines)}
              />
            </Drawer.Body>
            <Drawer.Footer>
              <Drawer.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Drawer.Close>
              <Button type="button" onClick={save} isLoading={saving}>
                Save variant profile
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer>
      </>
    )
  }
)

VariantCatalogProfileWidget.displayName = "VariantCatalogProfileWidget"
