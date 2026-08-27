import "server-only"

import { z } from "zod"

const publicFormServerSchema = z
  .object({
    PUBLIC_FORM_BFF_SECRET: z.string().min(32).optional(),
  })
  .transform((value) => ({
    publicFormBffSecret: value.PUBLIC_FORM_BFF_SECRET ?? null,
  }))

const parsed = publicFormServerSchema.safeParse({
  PUBLIC_FORM_BFF_SECRET: process.env.PUBLIC_FORM_BFF_SECRET,
})

if (!parsed.success) {
  console.error("❌ Invalid public-form server environment variables")
  console.error(z.flattenError(parsed.error).fieldErrors)
  throw new Error("Public-form server environment validation failed")
}

export const publicFormServerEnv = parsed.data
