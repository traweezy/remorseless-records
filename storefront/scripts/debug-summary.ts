import { config as loadEnv } from "dotenv"
import { Meilisearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"
import { enrichSearchResponse } from "@/lib/search/enrich"
import { searchProductsWithClient } from "@/lib/search/search"
import { mapHitToSummary } from "@/components/product-search-experience"

loadEnv({ quiet: true })

const run = async () => {
  const client = new Meilisearch({
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
