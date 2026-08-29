import "server-only"

import { z } from "zod"

const searchHost = process.env.MEILISEARCH_HOST
const searchKey =
  process.env.MEILISEARCH_SEARCH_KEY ?? process.env.MEILISEARCH_API_KEY

const searchServerSchema = z.object({
  meiliHost: z.string().url(),
  meiliSearchKey: z.string().min(1),
})

const parsed = searchServerSchema.safeParse({
  meiliHost: searchHost,
  meiliSearchKey: searchKey,
})

if (!parsed.success) {
  console.error("❌ Invalid server-only search environment variables")
  console.error(z.flattenError(parsed.error).fieldErrors)
  throw new Error("Search server environment validation failed")
}

export const searchServerEnv = parsed.data
