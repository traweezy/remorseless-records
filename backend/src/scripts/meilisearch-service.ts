import type { ExecArgs } from "@medusajs/framework/types"

export const MEILISEARCH_MODULE = "meilisearch"

export const resolveMeilisearchService = <T>(
  container: ExecArgs["container"]
): T => {
  if (
    typeof container.hasRegistration === "function" &&
    !container.hasRegistration(MEILISEARCH_MODULE)
  ) {
    throw new Error(
      "[meilisearch] Plugin module is not registered. Check MEILISEARCH_HOST, MEILISEARCH_ADMIN_KEY, and plugin config."
    )
  }

  return container.resolve(MEILISEARCH_MODULE) as T
}
