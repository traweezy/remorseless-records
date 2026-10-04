import type { HttpTypes } from "@medusajs/types"
import { z } from "zod"

const text = z.string().max(100_000).nullable()
const imageSchema = z
  .object({
    id: z.string().min(1).max(255),
    url: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^(https?:\/\/|\/(?!\/))/u),
    alt: z.string().max(2000).nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  })
  .strict()

export const catalogPresentationSchema = z
  .object({
    productId: z.string().regex(/^prod_[A-Za-z0-9_-]{1,249}$/u),
    profile: z
      .object({
        productType: text,
        label: text,
        artists: z.array(z.string().min(1).max(500)).max(100),
        genres: z.array(z.string().min(1).max(500)).max(100),
        descriptionHtml: z.string().max(250_000).nullable(),
        tracklist: z.array(z.string().min(1).max(10_000)).max(1000),
        credits: text,
        pressingNotes: text,
        merch: z
          .object({ material: text, fit: text, sizeGuide: text, care: text })
          .strict(),
      })
      .strict()
      .nullable(),
    managedMedia: z.boolean(),
    images: z.array(imageSchema).max(100),
  })
  .strict()

export type CatalogPresentation = z.infer<typeof catalogPresentationSchema>
export type PresentedStoreProduct = HttpTypes.StoreProduct & {
  presentation?: CatalogPresentation
}

export const readCatalogPresentations = (
  value: unknown,
  expectedIds: readonly string[]
): CatalogPresentation[] => {
  if (
    !expectedIds.length ||
    expectedIds.length > 25 ||
    new Set(expectedIds).size !== expectedIds.length
  )
    throw new Error("Invalid catalog presentation request")
  const { presentations } = z
    .object({
      presentations: z.array(catalogPresentationSchema).max(25),
    })
    .strict()
    .parse(value)
  const ids = presentations.map((row) => row.productId)
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !expectedIds.includes(id))
  )
    throw new Error("Invalid catalog presentation identity")
  return presentations
}

export const productPresentationType = (
  product: HttpTypes.StoreProduct
): string | null => {
  const presented = product as PresentedStoreProduct
  return (
    presented.presentation?.profile?.productType ??
    (typeof product.metadata?.product_type === "string"
      ? product.metadata.product_type
      : null)
  )
}
