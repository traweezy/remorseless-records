import { z } from "zod"

const publicErrorSchema = z.object({
  message: z.string().trim().min(1).max(500).optional(),
  detail: z.string().trim().min(1).max(500).optional(),
})

export const readPublicErrorMessage = (
  value: unknown,
  fallback: string
): string => {
  const parsed = publicErrorSchema.safeParse(value)
  return parsed.success
    ? (parsed.data.message ?? parsed.data.detail ?? fallback)
    : fallback
}
