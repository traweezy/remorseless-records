import "dotenv/config"

import { MeiliSearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"
import { enrichSearchResponse } from "@/lib/search/enrich"
import { searchProductsWithClient } from "@/lib/search/search"
import { mapHitToSummary } from "@/components/product-search-experience"

const run = async () => {
  const client = new MeiliSearch({
    host: runtimeEnv.meiliHost,
    apiKey: runtimeEnv.meiliSearchKey,
  })

  const response = await searchProductsWithClient(client, {
    query: "",
    limit: 1,
  })

  const enriched = await enrichSearchResponse(response)

  const summary = mapHitToSummary(enriched.hits[0])

  console.log(summary)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
