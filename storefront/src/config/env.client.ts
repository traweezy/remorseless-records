import { z } from "zod"

const clientSchema = z
  .object({
    NEXT_PUBLIC_MEDUSA_URL: z.string().url(),
    NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_STRIPE_PK: z.string().min(1),
    NEXT_PUBLIC_MEILI_HOST: z.string().url(),
    NEXT_PUBLIC_MEILI_SEARCH_KEY: z.string().min(1),
    NEXT_PUBLIC_MEDIA_URL: z.string().url().optional(),
    NEXT_PUBLIC_ASSET_HOST: z.string().url().optional(),
  })
  .transform((value) => ({
    medusaUrl: value.NEXT_PUBLIC_MEDUSA_URL,
    medusaPublishableKey: value.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
    stripePublishableKey: value.NEXT_PUBLIC_STRIPE_PK,
    meiliHost: value.NEXT_PUBLIC_MEILI_HOST,
    meiliSearchKey: value.NEXT_PUBLIC_MEILI_SEARCH_KEY,
    mediaUrl: value.NEXT_PUBLIC_MEDIA_URL ?? null,
    assetHost: value.NEXT_PUBLIC_ASSET_HOST ?? null,
  }))

const parsed = clientSchema.safeParse({
  NEXT_PUBLIC_MEDUSA_URL: process.env.NEXT_PUBLIC_MEDUSA_URL,
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
  NEXT_PUBLIC_STRIPE_PK: process.env.NEXT_PUBLIC_STRIPE_PK,
  NEXT_PUBLIC_MEILI_HOST: process.env.NEXT_PUBLIC_MEILI_HOST,
  NEXT_PUBLIC_MEILI_SEARCH_KEY: process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY,
  NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL,
  NEXT_PUBLIC_ASSET_HOST: process.env.NEXT_PUBLIC_ASSET_HOST,
})

if (!parsed.success) {
  console.error("❌ Invalid public environment variables")
  console.error(parsed.error.flatten().fieldErrors)
  throw new Error("Client environment variables validation failed")
}

export const clientEnv = parsed.data
