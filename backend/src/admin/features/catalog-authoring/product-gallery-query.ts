import { z } from "zod"

import {
  AdminRequestError,
  requestAdminJson,
  type AdminSdkClient,
} from "../../lib/admin-request"

const identifier = () =>
  z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/u)
const actorIdentifier = z.string().regex(/^user_[A-Za-z0-9_-]{1,248}$/u)
const mediaRole = z.enum([
  "gallery",
  "primary",
  "variant",
  "artist_photo",
  "news_cover",
  "open_graph",
])
const jsonRecord = z.record(z.string(), z.json())
const sourceUrl = z
  .string()
  .max(2_048)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol)
    } catch {
      return false
    }
  })

export const galleryLinkSchema = z.object({
  id: identifier(),
  productId: identifier(),
  variantId: identifier().nullable(),
  productProfileId: identifier().nullable(),
  mediaAssetId: identifier(),
  role: mediaRole,
  sortOrder: z.number().int().min(0).max(10_000),
  isPrimary: z.boolean(),
  metadata: jsonRecord,
  asset: z
    .object({
      id: identifier(),
      sourceUrl,
      altText: z.string().max(10_000).nullable(),
      originalFilename: z.string().max(255).nullable(),
      lifecycleStatus: z.enum(["active", "quarantined"]),
      version: z.number().int().positive(),
    })
    .nullable(),
})

export const productGallerySchema = z
  .object({
    productId: identifier(),
    version: z.number().int().nonnegative(),
    media: z.array(galleryLinkSchema).max(100),
  })
  .refine(
    (value) =>
      new Set(value.media.map((item) => item.id)).size === value.media.length &&
      value.media.every(
        (item) =>
          item.productId === value.productId &&
          (!item.asset || item.asset.id === item.mediaAssetId)
      )
  )

export const galleryInputSchema = galleryLinkSchema
  .pick({
    mediaAssetId: true,
    variantId: true,
    productProfileId: true,
    role: true,
    sortOrder: true,
    isPrimary: true,
    metadata: true,
  })
  .strict()

export const productGalleryBodySchema = z
  .object({
    expectedActorId: actorIdentifier,
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    media: z.array(galleryInputSchema).max(100),
  })
  .strict()

export type ProductGallery = z.infer<typeof productGallerySchema>
export type GalleryLink = z.infer<typeof galleryLinkSchema>
export type GalleryInput = z.infer<typeof galleryInputSchema>
export type ProductGalleryBody = z.infer<typeof productGalleryBodySchema>
export type GalleryRequestOptions = {
  client?: AdminSdkClient
  signal?: AbortSignal
  isCurrent?: () => boolean
}

export const assertCurrentGallery = (options: GalleryRequestOptions): void => {
  if (options.signal?.aborted || options.isCurrent?.() === false)
    throw new AdminRequestError("The gallery context changed.", "cancelled")
}

export const fetchGalleryActor = async (
  options: GalleryRequestOptions = {}
): Promise<string> => {
  const response = await requestAdminJson({
    path: "/admin/users/me",
    schema: z.object({ user: z.object({ id: actorIdentifier }) }),
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  assertCurrentGallery(options)
  return response.user.id
}

export const fetchProductGallery = async (
  productId: string,
  options: GalleryRequestOptions = {}
): Promise<ProductGallery> => {
  const parsedId = identifier().parse(productId)
  const response = await requestAdminJson({
    path: `/admin/catalog/products/${encodeURIComponent(parsedId)}/media`,
    schema: productGallerySchema,
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  assertCurrentGallery(options)
  if (response.productId !== parsedId)
    throw new AdminRequestError(
      "The gallery belongs to another product.",
      "invalid-response"
    )
  return response
}

export const putProductGallery = async (
  productId: string,
  body: ProductGalleryBody,
  options: GalleryRequestOptions = {}
): Promise<ProductGallery> => {
  const parsedId = identifier().parse(productId)
  const request = productGalleryBodySchema.parse(body)
  assertCurrentGallery(options)
  const response = await requestAdminJson({
    body: request,
    method: "PUT",
    path: `/admin/catalog/products/${encodeURIComponent(parsedId)}/media`,
    schema: productGallerySchema,
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  assertCurrentGallery(options)
  return response
}

export const galleryCanonical = (value: unknown): string => {
  const order = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(order)
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, order(entry)])
      )
    return item
  }
  return JSON.stringify(order(value))
}

const galleryInput = (item: GalleryInput | GalleryLink): GalleryInput =>
  galleryInputSchema.parse({
    mediaAssetId: item.mediaAssetId,
    variantId: item.variantId,
    productProfileId: item.productProfileId,
    role: item.role,
    sortOrder: item.sortOrder,
    isPrimary: item.isPrimary,
    metadata: item.metadata,
  })

export const galleryInputs = (media: readonly GalleryLink[]): GalleryInput[] =>
  media.map(galleryInput)

// Link IDs and timestamps are intentionally replaced by the existing API.
// Compare the entire multiset of link semantics, including opaque metadata.
export const gallerySemantics = (
  media: readonly (GalleryInput | GalleryLink)[]
): string =>
  galleryCanonical(
    media.map((item) => galleryCanonical(galleryInput(item))).sort()
  )

export const galleryPreflight = (
  media: readonly GalleryLink[],
  profileId: string | null | undefined,
  variantIds: readonly string[]
): string | null => {
  if (profileId === undefined)
    return "Wait for the current catalog profile to load."
  const scopes = new Map<
    string,
    { primary: number; sorts: Set<number>; assets: Set<string> }
  >()
  for (const item of media) {
    if (!item.asset || item.asset.lifecycleStatus !== "active")
      return "Every gallery image must have an active managed file before saving."
    if (item.variantId && !variantIds.includes(item.variantId))
      return "A gallery image belongs to an unavailable variant. Refresh the product."
    if (item.productProfileId !== profileId)
      return "The gallery profile association differs from the current catalog profile. Review it before saving."
    if (item.role === "primary" && !item.isPrimary)
      return "Choose a primary image to resolve the gallery's primary flags."
    const scope =
      item.variantId === null ? "product" : `variant:${item.variantId}`
    const group = scopes.get(scope) ?? {
      primary: 0,
      sorts: new Set<number>(),
      assets: new Set<string>(),
    }
    if (group.assets.has(item.mediaAssetId))
      return "A managed image appears twice in one gallery. Review the duplicate before saving."
    if (group.sorts.has(item.sortOrder))
      return "Images have the same position. Move an image earlier or later to set a clear order."
    group.assets.add(item.mediaAssetId)
    group.sorts.add(item.sortOrder)
    group.primary += Number(item.isPrimary || item.role === "primary")
    scopes.set(scope, group)
  }
  if ([...scopes.values()].some((group) => group.primary > 1))
    return "Choose only one primary image in each product or variant gallery."
  if (scopes.has("product") && scopes.get("product")?.primary !== 1)
    return "Choose a primary product image before saving."
  return null
}

export const orderGalleryLinks = (
  media: readonly GalleryLink[]
): GalleryLink[] =>
  [...media].sort(
    (a, b) =>
      (a.variantId ?? "").localeCompare(b.variantId ?? "") ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id)
  )

export const makeGalleryPrimary = (
  media: readonly GalleryLink[],
  id: string
): GalleryLink[] => {
  const selected = media.find((item) => item.id === id)
  if (!selected) return [...media]
  return media.map((item) =>
    item.variantId !== selected.variantId
      ? item
      : {
          ...item,
          isPrimary: item.id === id,
          role:
            item.id === id
              ? item.variantId
                ? "variant"
                : "primary"
              : item.role === "primary"
                ? item.variantId
                  ? "variant"
                  : "gallery"
                : item.role,
        }
  )
}

export const moveGalleryLink = (
  media: readonly GalleryLink[],
  id: string,
  direction: -1 | 1
): GalleryLink[] => {
  const selected = media.find((item) => item.id === id)
  if (!selected) return [...media]
  const group = orderGalleryLinks(
    media.filter((item) => item.variantId === selected.variantId)
  )
  const index = group.findIndex((item) => item.id === id)
  const destination = index + direction
  if (destination < 0 || destination >= group.length) return [...media]
  const moved = group.splice(index, 1)[0]!
  group.splice(destination, 0, moved)
  const positions = new Map(group.map((item, position) => [item.id, position]))
  return media.map((item) =>
    positions.has(item.id)
      ? { ...item, sortOrder: positions.get(item.id)! }
      : item
  )
}
