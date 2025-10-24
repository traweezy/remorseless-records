import { z } from "zod"

const clientSchema = z.object({
  medusaUrl: z.string().url(),
  medusaPublishableKey: z.string().min(1),
  stripePublishableKey: z.string().min(1),
  meiliHost: z.string().url(),
  meiliSearchKey: z.string().min(1),
  mediaUrl: z.string().url().nullable(),
  assetHost: z.string().url().nullable(),
})

const rawEnv = {
  medusaUrl:
    process.env.NEXT_PUBLIC_MEDUSA_URL ??
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ??
    process.env.MEDUSA_BACKEND_URL ??
    "",
  medusaPublishableKey:
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
    process.env.MEDUSA_PUBLISHABLE_KEY ??
    process.env.MEDUSA_PUBLISHABLE_API_KEY ??
    "",
  stripePublishableKey:
    process.env.NEXT_PUBLIC_STRIPE_PK ??
    process.env.NEXT_PUBLIC_STRIPE_KEY ??
    process.env.STRIPE_PUBLISHABLE_KEY ??
    "",
  meiliHost: process.env.NEXT_PUBLIC_MEILI_HOST ?? "",
  meiliSearchKey:
    process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY ??
    process.env.MEILI_SEARCH_KEY ??
    "",
  mediaUrl: process.env.NEXT_PUBLIC_MEDIA_URL ?? null,
  assetHost: process.env.NEXT_PUBLIC_ASSET_HOST ?? null,
}

const parsed = clientSchema.safeParse(rawEnv)

if (!parsed.success) {
  console.error("❌ Invalid public environment variables")
  console.error(parsed.error.flatten().fieldErrors)
  throw new Error("Client environment variables validation failed")
}

export const clientEnv = parsed.data
