import "server-only"

import { z } from "zod"

const preferredHost = process.env.MEILISEARCH_HOST
const preferredKey =
  process.env.MEILISEARCH_SEARCH_KEY ?? process.env.MEILISEARCH_API_KEY
const legacyHost = process.env.NEXT_PUBLIC_MEILI_HOST
const legacyKey = process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY
const usePreferredConfiguration = Boolean(preferredHost)

const searchServerSchema = z
  .object({
    meiliHost: z.string().url(),
    meiliSearchKey: z.string().min(1),
  })
  .transform((value) => ({
    ...value,
    usingLegacyPublicVariables: !usePreferredConfiguration,
  }))

const parsed = searchServerSchema.safeParse({
  meiliHost: usePreferredConfiguration
    ? (preferredHost ?? "")
    : (legacyHost ?? ""),
  meiliSearchKey: usePreferredConfiguration
    ? (preferredKey ?? "")
    : (legacyKey ?? ""),
})

if (!parsed.success) {
  console.error("❌ Invalid server-only search environment variables")
  console.error(z.flattenError(parsed.error).fieldErrors)
  throw new Error("Search server environment validation failed")
}

export const searchServerEnv = parsed.data
