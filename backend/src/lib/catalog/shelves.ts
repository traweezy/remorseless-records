type ScheduledRecord = {
  starts_at?: unknown
  startsAt?: unknown
  ends_at?: unknown
  endsAt?: unknown
}

export type ResolvableShelf = ScheduledRecord & {
  mode?: unknown
  automation_type?: unknown
  automationType?: unknown
  product_limit?: unknown
  productLimit?: unknown
  metadata?: unknown
  is_active?: unknown
  isActive?: unknown
}

export type ResolvableShelfProduct = ScheduledRecord & {
  product_id?: unknown
  productId?: unknown
  sort_order?: unknown
  sortOrder?: unknown
  is_pinned?: unknown
  isPinned?: unknown
}

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toInteger = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) ? value : fallback

const toBoolean = (value: unknown): boolean => value === true

const toProductId = (value: ResolvableShelfProduct): string | null => {
  const candidate = value.product_id ?? value.productId
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null
}

const unique = (values: readonly string[]): string[] =>
  Array.from(new Set(values))

export const isScheduledRecordActive = (
  value: ScheduledRecord,
  now: Date = new Date()
): boolean => {
  const startsAt = toDate(value.starts_at ?? value.startsAt)
  const endsAt = toDate(value.ends_at ?? value.endsAt)
  const timestamp = now.getTime()

  return (
    (!startsAt || startsAt.getTime() <= timestamp) &&
    (!endsAt || endsAt.getTime() > timestamp)
  )
}

export const isCatalogShelfActive = (
  shelf: ResolvableShelf,
  now: Date = new Date()
): boolean =>
  shelf.is_active !== false &&
  shelf.isActive !== false &&
  isScheduledRecordActive(shelf, now)

export const getNewReleaseLookbackDays = (shelf: ResolvableShelf): number => {
  const metadata =
    shelf.metadata && typeof shelf.metadata === "object" && !Array.isArray(shelf.metadata)
      ? (shelf.metadata as Record<string, unknown>)
      : {}
  const candidate = metadata.lookbackDays ?? metadata.lookback_days
  const days = toInteger(candidate, 180)
  return Math.min(Math.max(days, 1), 3650)
}

export const isNewReleaseCandidate = ({
  shelf,
  releaseDate,
  createdAt,
  now = new Date(),
}: {
  shelf: ResolvableShelf
  releaseDate: unknown
  createdAt?: unknown
  now?: Date
}): boolean => {
  if (!isCatalogShelfActive(shelf, now)) {
    return false
  }

  const automationType = shelf.automation_type ?? shelf.automationType
  if (automationType !== "new_release") {
    return false
  }

  const candidateDate = toDate(releaseDate) ?? toDate(createdAt)
  if (!candidateDate) {
    return false
  }

  const ageMs = now.getTime() - candidateDate.getTime()
  const lookbackMs = getNewReleaseLookbackDays(shelf) * 86_400_000
  return ageMs >= 0 && ageMs <= lookbackMs
}

export const resolveShelfProductIds = ({
  shelf,
  memberships,
  automaticProductIds,
  visibleProductIds,
  now = new Date(),
}: {
  shelf: ResolvableShelf
  memberships: ResolvableShelfProduct[]
  automaticProductIds: string[]
  visibleProductIds: ReadonlySet<string>
  now?: Date
}): string[] => {
  if (!isCatalogShelfActive(shelf, now)) {
    return []
  }

  const activeMemberships = memberships
    .filter((membership) => isScheduledRecordActive(membership, now))
    .map((membership, index) => ({
      id: toProductId(membership),
      pinned: toBoolean(membership.is_pinned ?? membership.isPinned),
      order: toInteger(membership.sort_order ?? membership.sortOrder, index),
      index,
    }))
    .filter(
      (membership): membership is {
        id: string
        pinned: boolean
        order: number
        index: number
      } => Boolean(membership.id && visibleProductIds.has(membership.id))
    )
    .sort((left, right) => left.order - right.order || left.index - right.index)

  const manualIds = unique(activeMemberships.map((membership) => membership.id))
  const pinnedIds = unique(
    activeMemberships
      .filter((membership) => membership.pinned)
      .map((membership) => membership.id)
  )
  const unpinnedIds = manualIds.filter((id) => !pinnedIds.includes(id))
  const automaticIds = unique(
    automaticProductIds.filter((id) => visibleProductIds.has(id))
  )
  const mode = shelf.mode === "automatic" || shelf.mode === "hybrid"
    ? shelf.mode
    : "manual"

  const resolved =
    mode === "automatic"
      ? unique([...pinnedIds, ...automaticIds])
      : mode === "hybrid"
        ? unique([...pinnedIds, ...automaticIds, ...unpinnedIds])
        : manualIds
  const requestedLimit = toInteger(
    shelf.product_limit ?? shelf.productLimit,
    12
  )
  const limit = Math.min(Math.max(requestedLimit, 1), 50)
  return resolved.slice(0, limit)
}
