import {
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "../lib/provider-boundary/primitives"
import {
  asUnknownRecord,
  readRecordArray,
} from "../lib/provider-boundary/records"

const REQUEST_TIMEOUT_MS = 30_000
const MAXIMUM_INDEXES = 1_000

export type MeilisearchTask = {
  taskUid: number
}

export type MeilisearchIndexSummary = {
  createdAt: string
  uid: string
}

type Fetch = typeof fetch

const parseErrorDetail = async (response: Response): Promise<string> => {
  const body = await response.text()
  return body.slice(0, 500) || response.statusText
}

const malformedAdminResponse = (): never => {
  throw new Error("[meilisearch] Admin API returned malformed structured data.")
}

const readTask = (value: unknown): MeilisearchTask => {
  const record = asUnknownRecord(value)
  const taskUid = readNonNegativeSafeInteger(record?.taskUid)
  return taskUid === null ? malformedAdminResponse() : { taskUid }
}

const readIndexes = (value: unknown): MeilisearchIndexSummary[] => {
  const envelope = asUnknownRecord(value)
  const records = readRecordArray(envelope?.results, {
    context: "Meilisearch index list",
  })
  if (records.length > MAXIMUM_INDEXES) {
    return malformedAdminResponse()
  }
  const seen = new Set<string>()
  return records.map((record) => {
    const uid =
      typeof record.uid === "string" &&
      record.uid === record.uid.trim() &&
      /^[A-Za-z0-9_-]{1,255}$/.test(record.uid)
        ? record.uid
        : null
    const createdAt = readIsoTimestamp(record.createdAt)
    if (!uid || !createdAt || seen.has(uid)) {
      return malformedAdminResponse()
    }
    seen.add(uid)
    return { createdAt, uid }
  })
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
    decode: (value: unknown) => T,
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

    const payload: unknown = await response.json()
    return decode(payload)
  }

  return {
    deleteIndex: async (indexKey: string): Promise<MeilisearchTask> => {
      assertCandidateIndexName(indexKey)
      return request(`/indexes/${encodeURIComponent(indexKey)}`, readTask, {
        method: "DELETE",
      })
    },
    listIndexes: async (): Promise<MeilisearchIndexSummary[]> => {
      return request("/indexes?limit=1000", readIndexes)
    },
    swapIndexes: async (
      liveIndex: string,
      candidateIndex: string
    ): Promise<MeilisearchTask> => {
      if (liveIndex !== "products") {
        throw new Error("[meilisearch] Live index must be 'products'.")
      }
      assertCandidateIndexName(candidateIndex)
      return request("/swap-indexes", readTask, {
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
