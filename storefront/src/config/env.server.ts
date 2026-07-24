import { z } from "zod"

const serverSchema = z
  .object({
    MEDUSA_BACKEND_URL: z.string().url().optional(),
  })
  .transform((value) => ({
    medusaBackendUrl: value.MEDUSA_BACKEND_URL ?? null,
  }))

const parsed = serverSchema.safeParse({
  MEDUSA_BACKEND_URL: process.env.MEDUSA_BACKEND_URL,
})

if (!parsed.success) {
  console.error("❌ Invalid server environment variables")
  console.error(z.flattenError(parsed.error).fieldErrors)
  throw new Error("Server environment variables validation failed")
}

export const serverEnv = parsed.data
