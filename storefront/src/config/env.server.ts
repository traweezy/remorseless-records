import { z } from "zod"
import { safeLogError } from "@/lib/logging"

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
  safeLogError("❌ Invalid server environment variables", parsed.error.flatten().fieldErrors)
  throw new Error("Server environment variables validation failed")
}

export const serverEnv = parsed.data
