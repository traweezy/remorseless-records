import { MeiliSearch } from "meilisearch"

import { runtimeEnv } from "@/config/env"

let browserClient: MeiliSearch | null = null

export const getBrowserSearchClient = (): MeiliSearch => {
  if (!browserClient) {
    const host = runtimeEnv.meiliHost
    const apiKey = runtimeEnv.meiliSearchKey

    if (!host || !apiKey) {
      throw new Error(
        "Meilisearch host or API key missing. Ensure NEXT_PUBLIC_MEILI_HOST and NEXT_PUBLIC_MEILI_SEARCH_KEY are set."
      )
    }

    browserClient = new MeiliSearch({
      host,
      apiKey,
    })
  }

  return browserClient
}
