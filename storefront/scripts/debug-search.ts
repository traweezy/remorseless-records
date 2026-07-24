import { config as loadEnv } from "dotenv"
import { Meilisearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"
import { enrichSearchResponse } from "@/lib/search/enrich"
import { searchProductsWithClient } from "@/lib/search/search"

loadEnv({ quiet: true })

const run = async () => {
  const client = new Meilisearch({
    host: runtimeEnv.meiliHost,
    apiKey: runtimeEnv.meiliSearchKey,
  })

  const response = await searchProductsWithClient(client, {
    query: "",
    limit: 2,
    offset: 0,
  })

  const enriched = await enrichSearchResponse(response)

  console.log({
    total: enriched.total,
    hasMore: enriched.hasMore,
    nextOffset: enriched.nextOffset,
    hits: enriched.hits.map((hit) => ({
      handle: hit.handle,
      genres: hit.genres,
      metalGenres: hit.metalGenres,
      categoryHandles: hit.categoryHandles,
    })),
  })
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
