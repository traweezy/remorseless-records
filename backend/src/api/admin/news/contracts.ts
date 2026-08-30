import { z } from "@medusajs/framework/zod"

import { newsWriteStatusValues } from "@/modules/news/serializers"

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable()

const optionalPublicationDateSchema = z
  .string()
  .trim()
  .max(100)
  .refine(
    (value) => value.length === 0 || Number.isFinite(Date.parse(value)),
    "Invalid publication date."
  )
  .optional()
  .nullable()

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const optionalCoverUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine(isHttpUrl, "Cover URL must use http or https.")
  .optional()
  .nullable()

const newsFieldsSchema = z.object({
  content: z.string().trim().min(1).max(200_000).optional(),
  coverAltText: optionalText(500),
  coverUrl: optionalCoverUrlSchema,
  excerpt: optionalText(1_000),
  publishedAt: optionalPublicationDateSchema,
  status: z.enum(newsWriteStatusValues).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  title: z.string().trim().min(1).max(300).optional(),
})

export const newsCreateSchema = newsFieldsSchema.extend({
  content: z.string().trim().min(1).max(200_000),
  expectedVersion: z.literal(0),
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
})

export const newsUpdateSchema = newsFieldsSchema.extend({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
})

export const newsLifecycleSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().uuid(),
})

export type NewsCreateInput = z.infer<typeof newsCreateSchema>
export type NewsUpdateInput = z.infer<typeof newsUpdateSchema>
export type NewsLifecycleInput = z.infer<typeof newsLifecycleSchema>
