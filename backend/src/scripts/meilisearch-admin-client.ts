const REQUEST_TIMEOUT_MS = 30_000

export type MeilisearchTask = {
  taskUid: number
}

export type MeilisearchIndexSummary = {
  createdAt: string
  uid: string
}

type Fetch = typeof fetch

type ResourceResults<T> = {
  results: T[]
}

const parseErrorDetail = async (response: Response): Promise<string> => {
  const body = await response.text()
  return body.slice(0, 500) || response.statusText
}

export const assertCandidateIndexName = (indexKey: string): void => {
  if (!/^products_build_[a-z0-9_-]+$/.test(indexKey)) {
    throw new Error(
      "[meilisearch] Candidate index must match products_build_[a-z0-9_-]+."
    )
  }
}

export const createMeilisearchAdminClient = ({
  apiKey,
  fetchImpl = fetch,
  host,
}: {
  apiKey: string
  fetchImpl?: Fetch
  host: string
}) => {
  if (!apiKey.trim()) {
    throw new Error("[meilisearch] Admin API key is required.")
  }

  const baseUrl = new URL(host)
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("[meilisearch] Host must use HTTP or HTTPS.")
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("[meilisearch] Host URL must not contain credentials.")
  }

  const request = async <T>(
    path: string,
    init?: RequestInit
  ): Promise<T> => {
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      const detail = await parseErrorDetail(response)
      throw new Error(
        `[meilisearch] Admin request ${init?.method ?? "GET"} ${path} failed (${response.status}): ${detail}`
      )
    }

    return (await response.json()) as T
  }

  return {
    deleteIndex: async (indexKey: string): Promise<MeilisearchTask> => {
      assertCandidateIndexName(indexKey)
      return request<MeilisearchTask>(
        `/indexes/${encodeURIComponent(indexKey)}`,
        { method: "DELETE" }
      )
    },
    listIndexes: async (): Promise<MeilisearchIndexSummary[]> => {
      const response = await request<
        ResourceResults<MeilisearchIndexSummary>
      >("/indexes?limit=1000")
      return response.results
    },
    swapIndexes: async (
      liveIndex: string,
      candidateIndex: string
    ): Promise<MeilisearchTask> => {
      if (liveIndex !== "products") {
        throw new Error("[meilisearch] Live index must be 'products'.")
      }
      assertCandidateIndexName(candidateIndex)
      return request<MeilisearchTask>("/swap-indexes", {
        body: JSON.stringify([
          {
            indexes: [liveIndex, candidateIndex],
          },
        ]),
        method: "POST",
      })
    },
  }
}

export const selectStaleCandidateIndexes = ({
  indexes,
  now,
  protectedIndexes,
  stabilityPeriodMs,
}: {
  indexes: MeilisearchIndexSummary[]
  now: Date
  protectedIndexes: Set<string>
  stabilityPeriodMs: number
}): string[] => {
  const cutoff = now.getTime() - stabilityPeriodMs

  return indexes
    .filter(({ uid }) => {
      if (protectedIndexes.has(uid)) {
        return false
      }
      const match =
        /^products_build_(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})(\d{3})z_[a-z0-9_-]+$/.exec(
          uid
        )
      if (!match) {
        return false
      }
      const [, year, month, day, hour, minute, second, millisecond] = match
      const buildTimestamp = Date.parse(
        `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`
      )
      return Number.isFinite(buildTimestamp) && buildTimestamp < cutoff
    })
    .map(({ uid }) => uid)
    .sort()
}
