import { z } from "zod"

export const shelfModes = ["manual", "automatic", "hybrid"] as const
export const automationTypes = ["none", "new_release"] as const

export type ShelfMode = (typeof shelfModes)[number]
export type AutomationType = (typeof automationTypes)[number]

export type AdminProduct = {
  id: string
  handle: string | null
  thumbnail: string | null
  title: string
}

const identifierSchema = z.string().trim().min(1).max(255)
const nullableTimestampSchema = z.iso.datetime().nullable()

export const catalogShelfSchema = z.object({
  archivedAt: nullableTimestampSchema,
  automationType: z.enum(automationTypes),
  description: z.string().max(50_000).nullable(),
  endsAt: nullableTimestampSchema,
  handle: z.string().trim().min(1).max(255),
  id: identifierSchema,
  isActive: z.boolean(),
  mode: z.enum(shelfModes),
  productLimit: z.number().int().positive().nullable(),
  ribbonLabel: z.string().max(5_000).nullable(),
  ribbonPriority: z.number().int(),
  showRibbon: z.boolean(),
  startsAt: nullableTimestampSchema,
  title: z.string().trim().min(1).max(5_000),
  version: z.number().int().nonnegative(),
})

export const catalogShelfProductSchema = z.object({
  endsAt: nullableTimestampSchema,
  id: identifierSchema,
  isPinned: z.boolean(),
  productId: identifierSchema,
  productProfileId: identifierSchema.nullable(),
  shelfId: identifierSchema,
  sortOrder: z.number().int().nonnegative(),
  startsAt: nullableTimestampSchema,
})

export const shelfResponseSchema = z
  .object({
    products: z.array(catalogShelfProductSchema).max(100),
    shelf: catalogShelfSchema,
  })
  .refine(
    ({ products, shelf }) =>
      products.every(({ shelfId }) => shelfId === shelf.id) &&
      new Set(products.map(({ id }) => id)).size === products.length
  )

export const shelfListResponseSchema = z.object({
  count: z.number().int().nonnegative().max(25_000),
  limit: z.number().int().positive().max(100),
  offset: z.number().int().nonnegative().max(25_000),
  shelves: z
    .array(shelfResponseSchema)
    .max(100)
    .refine(
      (shelves) =>
        new Set(shelves.map(({ shelf }) => shelf.id)).size === shelves.length
    ),
})

export const emptyShelfResponseSchema = z.undefined()

export type CatalogShelf = z.infer<typeof catalogShelfSchema>
export type CatalogShelfProduct = z.infer<typeof catalogShelfProductSchema>
export type ShelfResponse = z.infer<typeof shelfResponseSchema>

export type ShelfProductLine = {
  endsAt: string
  isPinned: boolean
  key: string
  productId: string
  sortOrder: string
  startsAt: string
}

export type ShelfFormState = {
  automationType: AutomationType
  description: string
  endsAt: string
  handle: string
  isActive: boolean
  mode: ShelfMode
  productLimit: string
  products: ShelfProductLine[]
  ribbonLabel: string
  ribbonPriority: string
  showRibbon: boolean
  startsAt: string
  title: string
  version: number
}

export type CreateShelfState = {
  automationType: AutomationType
  handle: string
  mode: ShelfMode
  productLimit: string
  ribbonLabel: string
  ribbonPriority: string
  showRibbon: boolean
  title: string
}
